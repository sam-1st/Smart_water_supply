const { sql } = require('@vercel/postgres');
const bcrypt = require('bcryptjs');

// Cached across warm serverless invocations so we don't re-run
// CREATE TABLE / seed checks on every request.
let initialized = false;

async function ensureSchema() {
  if (initialized) return;

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      zone TEXT,
      phone TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS zones (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS water_schedules (
      id SERIAL PRIMARY KEY,
      zone_id INTEGER NOT NULL REFERENCES zones(id),
      start_time TIMESTAMPTZ NOT NULL,
      end_time TIMESTAMPTZ NOT NULL,
      status TEXT DEFAULT 'scheduled',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS announcements (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      target_zone TEXT DEFAULT 'all',
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // Seed default admin
  const adminCheck = await sql`SELECT id FROM users WHERE email = 'admin@waterboard.com'`;
  if (adminCheck.rows.length === 0) {
    const hashed = bcrypt.hashSync('Admin@1234', 10);
    await sql`
      INSERT INTO users (full_name, email, password, role, zone)
      VALUES ('System Administrator', 'admin@waterboard.com', ${hashed}, 'admin', NULL)
    `;
    console.log('✅ Default admin seeded: admin@waterboard.com / Admin@1234');
  }

  // Seed default zones
  const zonesCheck = await sql`SELECT id FROM zones LIMIT 1`;
  if (zonesCheck.rows.length === 0) {
    for (const name of ['Zone A', 'Zone B', 'Zone C', 'Zone D']) {
      await sql`
        INSERT INTO zones (name, description)
        VALUES (${name}, ${name + ' residential area'})
        ON CONFLICT (name) DO NOTHING
      `;
    }
  }

  initialized = true;
}

module.exports = { sql, ensureSchema };
