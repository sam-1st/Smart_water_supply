const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const { getDb, query, run } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'smart_water_secret_key_2024_change_in_production';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Request Logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (req.method === 'POST' || req.method === 'PUT') {
    console.log('Body:', { ...req.body, password: req.body.password ? '***' : undefined });
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Middleware: verify JWT ───────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.cookies.token || req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────

// Register
app.post('/api/auth/register', async (req, res) => {
  const { full_name, email, password, zone, phone } = req.body;
  if (!full_name || !email || !password || !zone) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const existing = query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length) return res.status(409).json({ error: 'Email already registered' });

  const zoneCheck = query('SELECT id FROM zones WHERE name = ?', [zone]);
  if (!zoneCheck.length) return res.status(400).json({ error: 'Invalid service zone selection' });

  const hashed = bcrypt.hashSync(password, 10);
  const result = run(
    'INSERT INTO users (full_name, email, password, role, zone, phone) VALUES (?, ?, ?, ?, ?, ?)',
    [full_name, email, hashed, 'user', zone, phone || null]
  );

  res.status(201).json({ message: 'Account created successfully', userId: result.lastInsertRowid });
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const users = query('SELECT * FROM users WHERE email = ?', [email]);
  if (!users.length) return res.status(401).json({ error: 'Invalid email or password' });

  const user = users[0];
  const match = bcrypt.compareSync(password, user.password);
  if (!match) return res.status(401).json({ error: 'Invalid email or password' });

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, full_name: user.full_name, zone: user.zone },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.cookie('token', token, { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 });
  res.json({
    message: 'Login successful',
    user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role, zone: user.zone }
  });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

// Get current user
app.get('/api/auth/me', authMiddleware, (req, res) => {
  const users = query('SELECT id, full_name, email, role, zone, phone, created_at FROM users WHERE id = ?', [req.user.id]);
  if (!users.length) return res.status(404).json({ error: 'User not found' });
  res.json(users[0]);
});

// ─── ZONES ────────────────────────────────────────────────────────────────────
app.get('/api/zones', authMiddleware, (req, res) => {
  const zones = query('SELECT * FROM zones ORDER BY name');
  res.json(zones);
});

app.get('/api/public/zones', (req, res) => {
  const zones = query('SELECT * FROM zones ORDER BY name');
  res.json(zones);
});

// ─── SCHEDULES ────────────────────────────────────────────────────────────────
app.get('/api/schedules', authMiddleware, (req, res) => {
  let schedules;
  if (req.user.role === 'admin') {
    schedules = query(`
      SELECT ws.*, z.name as zone_name 
      FROM water_schedules ws 
      JOIN zones z ON ws.zone_id = z.id 
      ORDER BY ws.start_time DESC
    `);
  } else {
    schedules = query(`
      SELECT ws.*, z.name as zone_name 
      FROM water_schedules ws 
      JOIN zones z ON ws.zone_id = z.id 
      WHERE z.name = ?
      ORDER BY ws.start_time DESC
    `, [req.user.zone]);
  }
  res.json(schedules);
});

app.post('/api/schedules', authMiddleware, adminOnly, (req, res) => {
  const { zone_id, start_time, end_time, notes } = req.body;
  if (!zone_id || !start_time || !end_time) return res.status(400).json({ error: 'zone_id, start_time, end_time required' });
  const result = run(
    'INSERT INTO water_schedules (zone_id, start_time, end_time, notes) VALUES (?, ?, ?, ?)',
    [zone_id, start_time, end_time, notes || null]
  );
  res.status(201).json({ message: 'Schedule created', id: result.lastInsertRowid });
});

app.put('/api/schedules/:id', authMiddleware, adminOnly, (req, res) => {
  const { zone_id, start_time, end_time, notes, status } = req.body;
  run(
    'UPDATE water_schedules SET zone_id=?, start_time=?, end_time=?, notes=?, status=? WHERE id=?',
    [zone_id, start_time, end_time, notes, status || 'scheduled', req.params.id]
  );
  res.json({ message: 'Schedule updated' });
});

app.delete('/api/schedules/:id', authMiddleware, adminOnly, (req, res) => {
  run('DELETE FROM water_schedules WHERE id=?', [req.params.id]);
  res.json({ message: 'Schedule deleted' });
});

// ─── ANNOUNCEMENTS ────────────────────────────────────────────────────────────
app.get('/api/announcements', authMiddleware, (req, res) => {
  let announcements;
  if (req.user.role === 'admin') {
    announcements = query('SELECT * FROM announcements ORDER BY created_at DESC');
  } else {
    announcements = query(
      "SELECT * FROM announcements WHERE target_zone='all' OR target_zone=? ORDER BY created_at DESC",
      [req.user.zone]
    );
  }
  res.json(announcements);
});

app.post('/api/announcements', authMiddleware, adminOnly, (req, res) => {
  const { title, message, target_zone } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'Title and message required' });
  const result = run(
    'INSERT INTO announcements (title, message, target_zone, created_by) VALUES (?, ?, ?, ?)',
    [title, message, target_zone || 'all', req.user.id]
  );
  res.status(201).json({ message: 'Announcement sent', id: result.lastInsertRowid });
});

// ─── ADMIN: Users list ────────────────────────────────────────────────────────
app.get('/api/admin/users', authMiddleware, adminOnly, (req, res) => {
  const users = query('SELECT id, full_name, email, role, zone, phone, created_at FROM users ORDER BY created_at DESC');
  res.json(users);
});

// ─── REPORTS ─────────────────────────────────────────────────────────────────
app.get('/api/admin/reports', authMiddleware, adminOnly, (req, res) => {
  const totalUsers = query("SELECT COUNT(*) as count FROM users WHERE role='user'")[0]?.count || 0;
  const totalSchedules = query("SELECT COUNT(*) as count FROM water_schedules")[0]?.count || 0;
  const totalAnnouncements = query("SELECT COUNT(*) as count FROM announcements")[0]?.count || 0;
  const zoneStats = query(`
    SELECT z.name, COUNT(ws.id) as schedule_count
    FROM zones z
    LEFT JOIN water_schedules ws ON ws.zone_id = z.id
    GROUP BY z.id, z.name
  `);
  res.json({ totalUsers, totalSchedules, totalAnnouncements, zoneStats });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('🔥 Server Error:', err);
  res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

// ─── START ────────────────────────────────────────────────────────────────────
getDb().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Smart Water System running at http://localhost:${PORT}`);
    console.log(`👤 Default Admin → admin@waterboard.com / Admin@1234`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});