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
    let hostHint = '';
    try {
      const conn = process.env.POSTGRES_URL || process.env.DATABASE_URL || '';
      const u = new URL(conn);
      hostHint = ` (Host: ${u.hostname})`;
    } catch {}
    res.status(500).json({
      error: `Database initialization failed: ${err.message || 'Unknown error'}${hostHint}`
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
    SELECT id, full_name, email, role, zone, phone, meter_number, created_at
    FROM users ORDER BY created_at DESC
  `;
  res.json(users.rows);
}));

// ─── WATER BILL CALCULATION HELPER ──────────────────────────────────────────
function calculateWaterBill(units) {
  const unitsNum = Math.max(0, parseFloat(units) || 0);
  const baseFee = 50.00;
  let charge = 0;
  const breakdown = [];
  let remaining = unitsNum;

  // Tier 1: 0 - 6 m³ @ 45 KSh/m³
  const t1 = Math.min(remaining, 6);
  if (t1 > 0) {
    const cost = Math.round(t1 * 45 * 100) / 100;
    charge += cost;
    breakdown.push({ tier: 'Tier 1 (0–6 m³)', units: Math.round(t1 * 100) / 100, rate: 45, cost });
    remaining -= t1;
  }

  // Tier 2: 7 - 20 m³ @ 65 KSh/m³ (up to 14 units)
  if (remaining > 0) {
    const t2 = Math.min(remaining, 14);
    const cost = Math.round(t2 * 65 * 100) / 100;
    charge += cost;
    breakdown.push({ tier: 'Tier 2 (7–20 m³)', units: Math.round(t2 * 100) / 100, rate: 65, cost });
    remaining -= t2;
  }

  // Tier 3: 21 - 50 m³ @ 85 KSh/m³ (up to 30 units)
  if (remaining > 0) {
    const t3 = Math.min(remaining, 30);
    const cost = Math.round(t3 * 85 * 100) / 100;
    charge += cost;
    breakdown.push({ tier: 'Tier 3 (21–50 m³)', units: Math.round(t3 * 100) / 100, rate: 85, cost });
    remaining -= t3;
  }

  // Tier 4: > 50 m³ @ 110 KSh/m³
  if (remaining > 0) {
    const t4 = remaining;
    const cost = Math.round(t4 * 110 * 100) / 100;
    charge += cost;
    breakdown.push({ tier: 'Tier 4 (>50 m³)', units: Math.round(t4 * 100) / 100, rate: 110, cost });
  }

  const consumptionCharge = Math.round(charge * 100) / 100;
  const totalAmount = Math.round((baseFee + consumptionCharge) * 100) / 100;

  return {
    units: Math.round(unitsNum * 100) / 100,
    baseFee,
    consumptionCharge,
    totalAmount,
    breakdown
  };
}

// ─── METER READINGS & BILLING ROUTES ─────────────────────────────────────────

// Member: Get latest meter reading status & previous value
app.get('/api/meter/status', authMiddleware, asyncRoute(async (req, res) => {
  const lastReading = await sql`
    SELECT mr.*, b.id as bill_id, b.total_amount, b.status as bill_status, b.due_date, b.reply_message
    FROM meter_readings mr
    LEFT JOIN bills b ON b.reading_id = mr.id
    WHERE mr.user_id = ${req.user.id}
    ORDER BY mr.reading_date DESC, mr.id DESC
    LIMIT 1
  `;

  const userRes = await sql`SELECT meter_number FROM users WHERE id = ${req.user.id}`;
  const userMeter = userRes.rows[0]?.meter_number || null;

  if (lastReading.rows.length === 0) {
    return res.json({
      hasReadings: false,
      latestReading: 0,
      latestDate: null,
      meterNumber: userMeter || `MTR-${String(req.user.id).padStart(4, '0')}`,
      latestBill: null
    });
  }

  const row = lastReading.rows[0];
  res.json({
    hasReadings: true,
    latestReading: parseFloat(row.current_reading),
    latestDate: row.reading_date,
    meterNumber: row.meter_number || userMeter || `MTR-${String(req.user.id).padStart(4, '0')}`,
    latestBill: row.bill_id ? {
      id: row.bill_id,
      total_amount: parseFloat(row.total_amount),
      status: row.bill_status,
      due_date: row.due_date,
      reply_message: row.reply_message
    } : null
  });
}));

// Member: Get all meter readings & bills history
app.get('/api/meter/history', authMiddleware, asyncRoute(async (req, res) => {
  const history = await sql`
    SELECT mr.id as reading_id, mr.previous_reading, mr.current_reading, mr.consumption,
           mr.meter_number, mr.reading_date, mr.notes,
           b.id as bill_id, b.base_fee, b.consumption_charge, b.total_amount,
           b.status as bill_status, b.due_date, b.reply_message, b.paid_at
    FROM meter_readings mr
    LEFT JOIN bills b ON b.reading_id = mr.id
    WHERE mr.user_id = ${req.user.id}
    ORDER BY mr.reading_date DESC, mr.id DESC
  `;
  res.json(history.rows);
}));

// Member: Submit new meter reading, calculate bill, store and return instant reply
app.post('/api/meter/submit', authMiddleware, asyncRoute(async (req, res) => {
  const { current_reading, meter_number, notes } = req.body;
  if (current_reading === undefined || current_reading === null || current_reading === '') {
    return res.status(400).json({ error: 'Current meter reading is required' });
  }

  const currentVal = parseFloat(current_reading);
  if (isNaN(currentVal) || currentVal < 0) {
    return res.status(400).json({ error: 'Meter reading must be a valid non-negative number' });
  }

  // Get previous reading
  const lastReadingRes = await sql`
    SELECT current_reading, meter_number
    FROM meter_readings
    WHERE user_id = ${req.user.id}
    ORDER BY reading_date DESC, id DESC
    LIMIT 1
  `;

  const previousVal = lastReadingRes.rows.length ? parseFloat(lastReadingRes.rows[0].current_reading) : 0;
  if (currentVal < previousVal) {
    return res.status(400).json({
      error: `New reading (${currentVal} m³) cannot be lower than your previous reading (${previousVal} m³)`
    });
  }

  const consumption = Math.round((currentVal - previousVal) * 100) / 100;
  const meterNum = meter_number?.trim() || lastReadingRes.rows[0]?.meter_number || `MTR-${String(req.user.id).padStart(4, '0')}`;

  if (meter_number?.trim()) {
    await sql`UPDATE users SET meter_number = ${meterNum} WHERE id = ${req.user.id}`;
  }

  const billCalc = calculateWaterBill(consumption);
  const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const dueDateFormatted = dueDate.toLocaleDateString('en-KE', { dateStyle: 'medium' });

  // Formulate official instant reply
  const replyMessage = `Dear ${req.user.full_name}, your water meter reading of ${currentVal} m³ has been recorded. Water consumed: ${consumption} m³. Standing fee: KSh ${billCalc.baseFee.toFixed(2)}. Water consumption charge: KSh ${billCalc.consumptionCharge.toFixed(2)}. Total amount to pay: KSh ${billCalc.totalAmount.toFixed(2)}. Payment due by: ${dueDateFormatted}. Paybill: 247247, Account: WAT-${req.user.id}.`;

  const readingRes = await sql`
    INSERT INTO meter_readings (user_id, previous_reading, current_reading, consumption, meter_number, notes)
    VALUES (${req.user.id}, ${previousVal}, ${currentVal}, ${consumption}, ${meterNum}, ${notes || null})
    RETURNING id, reading_date
  `;
  const readingId = readingRes.rows[0].id;
  const readingDate = readingRes.rows[0].reading_date;

  const billRes = await sql`
    INSERT INTO bills (reading_id, user_id, units_consumed, base_fee, consumption_charge, total_amount, status, due_date, reply_message)
    VALUES (${readingId}, ${req.user.id}, ${consumption}, ${billCalc.baseFee}, ${billCalc.consumptionCharge}, ${billCalc.totalAmount}, 'unpaid', ${dueDate}, ${replyMessage})
    RETURNING id
  `;
  const billId = billRes.rows[0].id;

  res.status(201).json({
    message: 'Meter reading recorded and bill generated successfully',
    reply: {
      billId,
      readingId,
      userName: req.user.full_name,
      meterNumber: meterNum,
      readingDate,
      previousReading: previousVal,
      currentReading: currentVal,
      consumption,
      baseFee: billCalc.baseFee,
      consumptionCharge: billCalc.consumptionCharge,
      totalAmount: billCalc.totalAmount,
      breakdown: billCalc.breakdown,
      dueDate,
      dueDateFormatted,
      status: 'unpaid',
      accountNumber: `WAT-${req.user.id}`,
      paybill: '247247',
      replyMessage
    }
  });
}));

// Member or Admin: Mark bill as paid
app.post('/api/bills/:id/pay', authMiddleware, asyncRoute(async (req, res) => {
  const billId = req.params.id;
  const billQuery = req.user.role === 'admin'
    ? await sql`SELECT * FROM bills WHERE id = ${billId}`
    : await sql`SELECT * FROM bills WHERE id = ${billId} AND user_id = ${req.user.id}`;

  if (!billQuery.rows.length) {
    return res.status(404).json({ error: 'Bill not found' });
  }

  await sql`
    UPDATE bills
    SET status = 'paid', paid_at = NOW()
    WHERE id = ${billId}
  `;

  res.json({ message: 'Payment recorded successfully! Bill marked as paid.', billId });
}));

// Admin: View all bills and meter readings across all users
app.get('/api/admin/bills', authMiddleware, adminOnly, asyncRoute(async (req, res) => {
  const bills = await sql`
    SELECT b.*, mr.previous_reading, mr.current_reading, mr.consumption, mr.meter_number, mr.notes as reading_notes,
           u.full_name as user_name, u.email as user_email, u.zone as user_zone, u.phone as user_phone
    FROM bills b
    LEFT JOIN meter_readings mr ON b.reading_id = mr.id
    JOIN users u ON b.user_id = u.id
    ORDER BY b.created_at DESC
  `;
  res.json(bills.rows);
}));

// Admin: Update bill status (paid / unpaid)
app.put('/api/admin/bills/:id/status', authMiddleware, adminOnly, asyncRoute(async (req, res) => {
  const { status } = req.body;
  if (!['paid', 'unpaid'].includes(status)) {
    return res.status(400).json({ error: 'Status must be paid or unpaid' });
  }
  if (status === 'paid') {
    await sql`UPDATE bills SET status = 'paid', paid_at = NOW() WHERE id = ${req.params.id}`;
  } else {
    await sql`UPDATE bills SET status = 'unpaid', paid_at = NULL WHERE id = ${req.params.id}`;
  }
  res.json({ message: `Bill status updated to ${status}` });
}));

// ─── REPORTS ─────────────────────────────────────────────────────────────────
app.get('/api/admin/reports', authMiddleware, adminOnly, asyncRoute(async (req, res) => {
  const totalUsersR = await sql`SELECT COUNT(*)::int as count FROM users WHERE role = 'user'`;
  const totalSchedulesR = await sql`SELECT COUNT(*)::int as count FROM water_schedules`;
  const totalAnnouncementsR = await sql`SELECT COUNT(*)::int as count FROM announcements`;
  const totalReadingsR = await sql`SELECT COUNT(*)::int as count FROM meter_readings`;
  const billingStatsR = await sql`
    SELECT 
      COALESCE(SUM(total_amount), 0)::numeric(12, 2) as total_billed,
      COALESCE(SUM(CASE WHEN status = 'paid' THEN total_amount ELSE 0 END), 0)::numeric(12, 2) as total_paid,
      COALESCE(SUM(CASE WHEN status = 'unpaid' THEN total_amount ELSE 0 END), 0)::numeric(12, 2) as total_unpaid,
      COUNT(CASE WHEN status = 'unpaid' THEN 1 END)::int as unpaid_count
    FROM bills
  `;
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
    totalReadings: totalReadingsR.rows[0].count,
    billingStats: billingStatsR.rows[0] || { total_billed: 0, total_paid: 0, total_unpaid: 0, unpaid_count: 0 },
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
