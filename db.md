# 💧 Smart Water Supply System — Database Documentation & Plan

This document describes the current database implementation, highlights its limitations, outlines the current schema, and lays out a multi-phase upgrade plan for production reliability.

---

## 1. Current Database Implementation

The application currently runs on **sql.js** (SQLite compiled to WebAssembly) running inside Node.js.

*   **Database File**: [water_system.db](file:///Users/lil_kingstone/Dev_panda/Smart_water_supply/water_system.db)
*   **Runtime Operation**:
    1.  At server boot, the database file is read into memory as a binary buffer: `fs.readFileSync(DB_PATH)`.
    2.  The engine operates entirely in-memory during the application lifecycle.
    3.  Every write operation (e.g., insert, update, delete) triggers an export of the database buffer and writes the entire file back to disk: `fs.writeFileSync(DB_PATH, Buffer.from(db.export()))`.
*   **Query Wrappers**: Located in [database.js](file:///Users/lil_kingstone/Dev_panda/Smart_water_supply/database.js).

### ⚠️ Current Flaws and Vulnerabilities
1.  **Buggy Parameter Binding**: The `query()` and `run()` wrapper functions manually replace standard `?` placeholders with regex interpolation instead of letting SQLite do it natively. Any input containing a question mark (e.g. an announcement title *"Is the water supply active?"*) breaks the query binding logic.
2.  **Concurrency Bottlenecks**: Writing the entire file back to disk on every database write blocks the main Node.js event loop and can lead to data loss or file corruption under concurrent requests.
3.  **String-based Zone References**: The `users` and `announcements` tables reference zones by name (`TEXT`) instead of referencing `zones.id` (`INTEGER` foreign key).

---

## 2. Current Database Schema

The SQLite schema currently consists of four tables:

```sql
-- Users Directory (Citizens and Admins)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  zone TEXT,               -- Currently stored as string (e.g. 'Zone A')
  phone TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Service Zones
CREATE TABLE IF NOT EXISTS zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Water Distribution Schedules
CREATE TABLE IF NOT EXISTS water_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id INTEGER NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  status TEXT DEFAULT 'scheduled',
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (zone_id) REFERENCES zones(id)
);

-- System Announcements
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  target_zone TEXT DEFAULT 'all', -- Currently stored as string (e.g. 'all' or 'Zone A')
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);
```

---

## 3. Database Upgrade & Improvement Plan

We will improve the database in three sequential phases:

### Phase 1: Fix Parameter Bindings & SQL Safety (Immediate)
*   Refactor the `query()` and `run()` helper functions in [database.js](file:///Users/lil_kingstone/Dev_panda/Smart_water_supply/database.js) to pass arguments directly to `sql.js` native database binding (`db.exec(sql, params)`).
*   Remove the manual, unsafe regex replacement logic.

### Phase 2: Schema Normalization & Relations (Intermediate)
*   Modify `users` table: Rename or migrate `zone` (TEXT) to `zone_id` (INTEGER) pointing to `zones(id)`.
*   Modify `announcements` table: Migrate `target_zone` (TEXT) to `target_zone_id` (INTEGER, NULL for all zones).
*   Add indexes on frequently queried columns (`users.email`, `water_schedules.start_time`).

### Phase 3: Transition to a Production Database Engine (Long-Term)
*   Replace `sql.js` with a production-grade database engine:
    *   **Option A**: `better-sqlite3` (direct, concurrent block writes to disk, excellent for local VMs).
    *   **Option B**: PostgreSQL (standard client-server database, highly scalable, ideal for cloud hosting).
