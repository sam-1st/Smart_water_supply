const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'water_system.db');

let db;

async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      zone TEXT,
      phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS zones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS water_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zone_id INTEGER NOT NULL,
      start_time DATETIME NOT NULL,
      end_time DATETIME NOT NULL,
      status TEXT DEFAULT 'scheduled',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (zone_id) REFERENCES zones(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      target_zone TEXT DEFAULT 'all',
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);

  // Seed default admin if not exists
  const bcrypt = require('bcryptjs');
  const adminCheck = db.exec("SELECT id FROM users WHERE email='admin@waterboard.com'");
  if (!adminCheck.length || !adminCheck[0].values.length) {
    const hashed = bcrypt.hashSync('Admin@1234', 10);
    db.run(
      "INSERT INTO users (full_name, email, password, role, zone) VALUES (?, ?, ?, ?, ?)",
      ['System Administrator', 'admin@waterboard.com', hashed, 'admin', null]
    );
    console.log('✅ Default admin seeded: admin@waterboard.com / Admin@1234');
  }

  // Seed default zones
  const zonesCheck = db.exec("SELECT id FROM zones LIMIT 1");
  if (!zonesCheck.length || !zonesCheck[0].values.length) {
    ['Zone A', 'Zone B', 'Zone C', 'Zone D'].forEach(name => {
      db.run("INSERT INTO zones (name, description) VALUES (?, ?)", [name, `${name} residential area`]);
    });
  }

  saveDb();
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function query(sql, params = []) {
  const result = db.exec(sql, params);
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map(row => Object.fromEntries(columns.map((col, i) => [col, row[i]])));
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDb();
  const res = db.exec("SELECT last_insert_rowid() as id");
  return { lastInsertRowid: res[0]?.values[0][0] };
}

module.exports = { getDb, query, run, saveDb };