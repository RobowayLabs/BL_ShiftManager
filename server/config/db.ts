import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Default: sentinel.db in project root (shared with PyQt5 app)
const SQLITE_PATH =
  process.env.SQLITE_PATH ||
  path.resolve(__dirname, '../../sentinel.db');

let _db: Database.Database | null = null;

export function getDB(): Database.Database {
  if (!_db) {
    _db = new Database(SQLITE_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    _initTables(_db);
  }
  return _db;
}

function _initTables(db: Database.Database): void {
  // Web-only table: date-specific shift assignments created by managers
  db.exec(`
    CREATE TABLE IF NOT EXISTS shift_assignments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      shift_id    INTEGER NOT NULL REFERENCES shifts(id),
      date        TEXT    NOT NULL,
      status      TEXT    DEFAULT 'Scheduled',
      actual_start TEXT,
      actual_end   TEXT,
      created_at  TEXT    DEFAULT (datetime('now')),
      UNIQUE(employee_id, shift_id, date)
    )
  `);

  // Add acknowledged column to alert_events if missing (backward-compatible)
  try {
    db.exec('ALTER TABLE alert_events ADD COLUMN acknowledged INTEGER DEFAULT 0');
  } catch {
    // Column already exists — safe to ignore
  }

  // Performance summary table — calculated from shift_assignments + alert_events
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_performance (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id       INTEGER NOT NULL,
      employee_id_text  TEXT    NOT NULL,
      date              TEXT    NOT NULL,
      shift_type        TEXT    NOT NULL,
      total_alerts      INTEGER DEFAULT 0,
      drowsy_alerts     INTEGER DEFAULT 0,
      sleep_alerts      INTEGER DEFAULT 0,
      phone_alerts      INTEGER DEFAULT 0,
      absence_alerts    INTEGER DEFAULT 0,
      performance_grade TEXT    NOT NULL DEFAULT 'Excellent',
      work_seconds      INTEGER DEFAULT 0,
      shift_status      TEXT,
      calculated_at     TEXT    DEFAULT (datetime('now')),
      UNIQUE(employee_id, date, shift_type)
    )
  `);
}

export function connectDB(): void {
  getDB();
  console.log(`[SQLite] Connected to ${SQLITE_PATH}`);
}
