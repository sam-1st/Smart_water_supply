const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const { sql, ensureSchema } = require('../lib/db');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_in_production';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Make sure tables exist / are seeded before handling any request.
// Cheap no-op after the first warm invocation (see lib/db.js).
app.use(async (req, res, next) => {
  if (!process.env.POSTGRES_URL && !process.env.DATABASE_URL) {
    return res.status(500).json({
      error: 'Database connection missing: POSTGRES_URL is not set. Please connect a Postgres database in your Vercel project dashboard.'
    });
  }

  try {
    await ensureSchema();
    next();
  } catch (err) {
    console.error('DB init failed:', err);
    res.status(500).json({
      error: `Database initialization failed: ${err.message || 'Unknown error'}`
    });
  }
});

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

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const { full_name, email, password, zone, phone } = req.body;
  if (!full_name || !email || !password || !zone) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const existing = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (existing.rows.length) return res.status(409).json({ error: 'Email already registered' });

  const hashed = bcrypt.hashSync(password, 10);
  const result = await sql`
    INSERT INTO users (full_name, email, password, role, zone, phone)
    VALUES (${full_name}, ${email}, ${hashed}, 'user', ${zone}, ${phone || null})
    RETURNING id
  `;

  res.status(201).json({ message: 'Account created successfully', userId: result.rows[0].id });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const users = await sql`SELECT * FROM users WHERE email = ${email}`;
  if (!users.rows.length) return res.status(401).json({ error: 'Invalid email or password' });

  const user = users.rows[0];
  const match = bcrypt.compareSync(password, user.password);
  if (!match) return res.status(401).json({ error: 'Invalid email or password' });

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, full_name: user.full_name, zone: user.zone },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000
  });
  res.json({
    message: 'Login successful',
    user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role, zone: user.zone }
  });
}));

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

app.get('/api/auth/me', authMiddleware, asyncRoute(async (req, res) => {
  const users = await sql`
    SELECT id, full_name, email, role, zone, phone, created_at
    FROM users WHERE id = ${req.user.id}
  `;
  if (!users.rows.length) return res.status(404).json({ error: 'User not found' });
  res.json(users.rows[0]);
}));

// ─── ZONES ────────────────────────────────────────────────────────────────────
app.get('/api/zones', authMiddleware, asyncRoute(async (req, res) => {
  const zones = await sql`SELECT * FROM zones ORDER BY name`;
  res.json(zones.rows);
}));

// ─── SCHEDULES ────────────────────────────────────────────────────────────────
app.get('/api/schedules', authMiddleware, asyncRoute(async (req, res) => {
  let schedules;
  if (req.user.role === 'admin') {
    schedules = await sql`
      SELECT ws.*, z.name as zone_name
      FROM water_schedules ws
      JOIN zones z ON ws.zone_id = z.id
      ORDER BY ws.start_time DESC
    `;
  } else {
    schedules = await sql`
      SELECT ws.*, z.name as zone_name
      FROM water_schedules ws
      JOIN zones z ON ws.zone_id = z.id
      WHERE z.name = ${req.user.zone}
      ORDER BY ws.start_time DESC
    `;
  }
  res.json(schedules.rows);
}));

app.post('/api/schedules', authMiddleware, adminOnly, asyncRoute(async (req, res) => {
  const { zone_id, start_time, end_time, notes } = req.body;
  if (!zone_id || !start_time || !end_time) return res.status(400).json({ error: 'zone_id, start_time, end_time required' });
  const result = await sql`
    INSERT INTO water_schedules (zone_id, start_time, end_time, notes)
    VALUES (${zone_id}, ${start_time}, ${end_time}, ${notes || null})
    RETURNING id
  `;
  res.status(201).json({ message: 'Schedule created', id: result.rows[0].id });
}));

app.put('/api/schedules/:id', authMiddleware, adminOnly, asyncRoute(async (req, res) => {
  const { zone_id, start_time, end_time, notes, status } = req.body;
  await sql`
    UPDATE water_schedules
    SET zone_id = ${zone_id}, start_time = ${start_time}, end_time = ${end_time},
        notes = ${notes || null}, status = ${status || 'scheduled'}
    WHERE id = ${req.params.id}
  `;
  res.json({ message: 'Schedule updated' });
}));

app.delete('/api/schedules/:id', authMiddleware, adminOnly, asyncRoute(async (req, res) => {
  await sql`DELETE FROM water_schedules WHERE id = ${req.params.id}`;
  res.json({ message: 'Schedule deleted' });
}));

// ─── ANNOUNCEMENTS ────────────────────────────────────────────────────────────
app.get('/api/announcements', authMiddleware, asyncRoute(async (req, res) => {
  let announcements;
  if (req.user.role === 'admin') {
    announcements = await sql`SELECT * FROM announcements ORDER BY created_at DESC`;
  } else {
    announcements = await sql`
      SELECT * FROM announcements
      WHERE target_zone = 'all' OR target_zone = ${req.user.zone}
      ORDER BY created_at DESC
    `;
  }
  res.json(announcements.rows);
}));

app.post('/api/announcements', authMiddleware, adminOnly, asyncRoute(async (req, res) => {
  const { title, message, target_zone } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'Title and message required' });
  const result = await sql`
    INSERT INTO announcements (title, message, target_zone, created_by)
    VALUES (${title}, ${message}, ${target_zone || 'all'}, ${req.user.id})
    RETURNING id
  `;
  res.status(201).json({ message: 'Announcement sent', id: result.rows[0].id });
}));

// ─── ADMIN: Users list ────────────────────────────────────────────────────────
app.get('/api/admin/users', authMiddleware, adminOnly, asyncRoute(async (req, res) => {
  const users = await sql`
    SELECT id, full_name, email, role, zone, phone, created_at
    FROM users ORDER BY created_at DESC
  `;
  res.json(users.rows);
}));

// ─── REPORTS ─────────────────────────────────────────────────────────────────
app.get('/api/admin/reports', authMiddleware, adminOnly, asyncRoute(async (req, res) => {
  const totalUsersR = await sql`SELECT COUNT(*)::int as count FROM users WHERE role = 'user'`;
  const totalSchedulesR = await sql`SELECT COUNT(*)::int as count FROM water_schedules`;
  const totalAnnouncementsR = await sql`SELECT COUNT(*)::int as count FROM announcements`;
  const zoneStatsR = await sql`
    SELECT z.name, COUNT(ws.id)::int as schedule_count
    FROM zones z
    LEFT JOIN water_schedules ws ON ws.zone_id = z.id
    GROUP BY z.id, z.name
    ORDER BY z.name
  `;

  res.json({
    totalUsers: totalUsersR.rows[0].count,
    totalSchedules: totalSchedulesR.rows[0].count,
    totalAnnouncements: totalAnnouncementsR.rows[0].count,
    zoneStats: zoneStatsR.rows
  });
}));

// ─── Local dev only: Vercel imports this file as a handler, it never calls listen ──
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Smart Water System (dev) running at http://localhost:${PORT}`);
  });
}

module.exports = app;
