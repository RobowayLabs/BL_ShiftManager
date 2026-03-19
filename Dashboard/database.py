# ============================================================
#  database.py  —  SQLite data layer (WAL mode, thread-safe)
#  Extended with: shifts, RBAC users, audit log, system config,
#  alert events, off-days, weekly schedule
# ============================================================
import sqlite3
import threading
import json
import logging
from datetime import date, datetime, timedelta
from contextlib import contextmanager
from typing import Optional, List, Dict, Any

from config import DB_PATH

logger = logging.getLogger(__name__)


class Database:
    """Thread-safe SQLite wrapper using WAL journal mode.

    Each thread gets its own connection via threading.local so that
    concurrent reads from detection workers never block each other.
    """

    _local = threading.local()

    def __init__(self, path: str = DB_PATH):
        self._path = path
        self._init_schema()
        self._seed_defaults()

    # ── Connection management ─────────────────────────────────
    def _conn(self) -> sqlite3.Connection:
        if not getattr(self._local, "conn", None):
            conn = sqlite3.connect(self._path, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA cache_size=-8000")
            self._local.conn = conn
        return self._local.conn

    @contextmanager
    def tx(self):
        conn = self._conn()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    def execute(self, sql: str, params=()):
        with self.tx() as conn:
            return conn.execute(sql, params)

    def fetchall(self, sql: str, params=()):
        return self._conn().execute(sql, params).fetchall()

    def fetchone(self, sql: str, params=()):
        return self._conn().execute(sql, params).fetchone()

    # ── Schema ────────────────────────────────────────────────
    def _init_schema(self):
        with self.tx() as conn:
            conn.executescript("""
            CREATE TABLE IF NOT EXISTS employees (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT    NOT NULL,
                employee_id TEXT    UNIQUE NOT NULL,
                department  TEXT    DEFAULT '',
                photo_path  TEXT    DEFAULT '',
                calib_path  TEXT    DEFAULT '',
                created_at  TEXT    DEFAULT (datetime('now')),
                active      INTEGER DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS employee_photos (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
                path        TEXT    NOT NULL,
                created_at  TEXT    DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS sessions (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                employee_id INTEGER REFERENCES employees(id),
                date        TEXT    NOT NULL,
                start_time  TEXT    NOT NULL,
                end_time    TEXT,
                cam_index   INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS events (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id   INTEGER REFERENCES sessions(id),
                employee_id  INTEGER REFERENCES employees(id),
                event_type   TEXT    NOT NULL,
                started_at   TEXT    NOT NULL,
                ended_at     TEXT,
                duration_sec REAL    DEFAULT 0,
                severity     TEXT    DEFAULT 'info',
                notes        TEXT    DEFAULT '',
                image_path   TEXT    DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS daily_summary (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                employee_id     INTEGER REFERENCES employees(id),
                date            TEXT    NOT NULL,
                total_work_sec  REAL    DEFAULT 0,
                sleep_sec       REAL    DEFAULT 0,
                drowsy_sec      REAL    DEFAULT 0,
                yawn_count      INTEGER DEFAULT 0,
                phone_sec       REAL    DEFAULT 0,
                phone_count     INTEGER DEFAULT 0,
                absence_sec     REAL    DEFAULT 0,
                productivity    REAL    DEFAULT 100.0,
                UNIQUE(employee_id, date)
            );
            CREATE TABLE IF NOT EXISTS attendance (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                employee_id     INTEGER NOT NULL REFERENCES employees(id),
                camera_id       INTEGER DEFAULT 0,
                event_type      TEXT    NOT NULL,
                status          TEXT    DEFAULT '',
                shift_id        INTEGER,
                recognized_at   TEXT    NOT NULL,
                image_path      TEXT    DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS shifts (
                id                   INTEGER PRIMARY KEY AUTOINCREMENT,
                label                TEXT    NOT NULL,
                start_time           TEXT    NOT NULL,
                end_time             TEXT    NOT NULL,
                late_grace_minutes   INTEGER DEFAULT 15,
                active               INTEGER DEFAULT 1,
                created_at           TEXT    DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS shift_breaks (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                shift_id    INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
                label       TEXT    DEFAULT 'Break',
                start_time  TEXT    NOT NULL,
                end_time    TEXT    NOT NULL
            );
            CREATE TABLE IF NOT EXISTS shift_roster (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                shift_id    INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
                employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
                UNIQUE(shift_id, employee_id)
            );
            CREATE TABLE IF NOT EXISTS weekly_schedule (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                shift_id    INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
                weekday     INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS off_days (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                date        TEXT    NOT NULL,
                shift_id    INTEGER DEFAULT NULL,
                note        TEXT    DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS users (
                id                   INTEGER PRIMARY KEY AUTOINCREMENT,
                username             TEXT    UNIQUE NOT NULL,
                password_hash        TEXT    NOT NULL,
                role                 TEXT    DEFAULT 'viewer',
                active               INTEGER DEFAULT 1,
                created_at           TEXT    DEFAULT (datetime('now')),
                last_login           TEXT,
                session_timeout_min  INTEGER DEFAULT 30
            );
            CREATE TABLE IF NOT EXISTS audit_log (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER REFERENCES users(id),
                username    TEXT    NOT NULL,
                action      TEXT    NOT NULL,
                details     TEXT    DEFAULT '',
                timestamp   TEXT    DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS system_config (
                key         TEXT    PRIMARY KEY,
                value       TEXT    NOT NULL,
                updated_at  TEXT    DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS alert_events (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                site_id         TEXT    DEFAULT 'banglalink',
                camera_id       TEXT    NOT NULL,
                employee_id     TEXT    DEFAULT '',
                employee_name   TEXT    DEFAULT '',
                alert_type      TEXT    NOT NULL,
                severity        TEXT    DEFAULT 'medium',
                shift_label     TEXT    DEFAULT '',
                thumbnail_path  TEXT    DEFAULT '',
                mqtt_published  INTEGER DEFAULT 0,
                redis_published INTEGER DEFAULT 0,
                timestamp       TEXT    NOT NULL,
                created_at      TEXT    DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_events_emp       ON events(employee_id, started_at);
            CREATE INDEX IF NOT EXISTS idx_summary_emp      ON daily_summary(employee_id, date);
            CREATE INDEX IF NOT EXISTS idx_attendance_emp   ON attendance(employee_id, recognized_at);
            CREATE INDEX IF NOT EXISTS idx_attendance_date  ON attendance(recognized_at);
            CREATE INDEX IF NOT EXISTS idx_shift_roster_emp ON shift_roster(employee_id);
            CREATE INDEX IF NOT EXISTS idx_off_days_date    ON off_days(date);
            CREATE INDEX IF NOT EXISTS idx_alert_events_ts  ON alert_events(timestamp);
            CREATE INDEX IF NOT EXISTS idx_audit_ts         ON audit_log(timestamp);
            """)
        self._migrate()

    def _migrate(self):
        for sql in [
            "ALTER TABLE events    ADD COLUMN image_path  TEXT DEFAULT ''",
            "ALTER TABLE attendance ADD COLUMN status     TEXT DEFAULT ''",
            "ALTER TABLE attendance ADD COLUMN shift_id   INTEGER",
            "ALTER TABLE attendance ADD COLUMN image_path TEXT DEFAULT ''",
        ]:
            try:
                with self.tx() as conn:
                    conn.execute(sql)
            except sqlite3.OperationalError:
                pass

    def _seed_defaults(self):
        # Admin user
        if not self.fetchone("SELECT 1 FROM users LIMIT 1"):
            try:
                import bcrypt
                pw_hash = bcrypt.hashpw(b"admin123", bcrypt.gensalt()).decode()
            except ImportError:
                import hashlib
                pw_hash = "sha256:" + hashlib.sha256(b"admin123").hexdigest()
            self.execute(
                "INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?,?,?)",
                ("admin", pw_hash, "admin")
            )

        # Default 3 shifts
        if not self.fetchone("SELECT 1 FROM shifts LIMIT 1"):
            for label, start, end in [("Morning","08:00","16:00"),
                                       ("Afternoon","16:00","00:00"),
                                       ("Night","00:00","08:00")]:
                self.execute(
                    "INSERT INTO shifts (label, start_time, end_time) VALUES (?,?,?)",
                    (label, start, end)
                )

        # Default config
        defaults = {
            "site_id":                    "banglalink",
            "face_recognition_interval":  "30",
            "tiredness_alert_minutes":    "5",
            "sleep_alert_seconds":        "60",
            "phone_alert_seconds":        "30",
            "absence_alert_minutes":      "5",
            "absence_escalation_minutes": "30",
            "crowding_threshold_persons": "2",
            "crowding_alert_minutes":     "2",
            "session_timeout_minutes":    "30",
            "mqtt_enabled":               "false",
            "mqtt_broker":                "localhost",
            "mqtt_port":                  "1883",
            "mqtt_use_tls":               "false",
            "redis_enabled":              "false",
            "redis_host":                 "localhost",
            "redis_port":                 "6379",
            "ear_threshold":              "0.20",
            "mar_threshold":              "0.55",
            "phone_conf_threshold":       "0.45",
            "show_camera_overlay":        "true",
            "save_evidence_images":       "true",
            "max_log_entries":            "500",
        }
        for key, val in defaults.items():
            self.execute(
                "INSERT OR IGNORE INTO system_config (key, value) VALUES (?,?)", (key, val)
            )

    # ── System config ─────────────────────────────────────────
    def get_config(self, key: str, default: str = "") -> str:
        row = self.fetchone("SELECT value FROM system_config WHERE key=?", (key,))
        return row["value"] if row else default

    def get_config_int(self, key: str, default: int = 0) -> int:
        try:
            return int(self.get_config(key, str(default)))
        except (ValueError, TypeError):
            return default

    def get_config_float(self, key: str, default: float = 0.0) -> float:
        try:
            return float(self.get_config(key, str(default)))
        except (ValueError, TypeError):
            return default

    def get_config_bool(self, key: str, default: bool = False) -> bool:
        return self.get_config(key, "true" if default else "false").lower() in ("1", "true", "yes")

    def set_config(self, key: str, value: str):
        self.execute(
            "INSERT INTO system_config (key, value, updated_at) VALUES (?,?,datetime('now')) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            (key, str(value))
        )

    def get_all_config(self) -> Dict[str, str]:
        rows = self.fetchall("SELECT key, value FROM system_config")
        return {r["key"]: r["value"] for r in rows}

    # ── Users / RBAC ─────────────────────────────────────────
    def get_user(self, username: str):
        return self.fetchone("SELECT * FROM users WHERE username=? AND active=1", (username,))

    def get_user_by_id(self, user_id: int):
        return self.fetchone("SELECT * FROM users WHERE id=?", (user_id,))

    def get_all_users(self):
        return self.fetchall(
            "SELECT id, username, role, active, created_at, last_login FROM users ORDER BY username"
        )

    def add_user(self, username: str, password: str, role: str = "viewer") -> int:
        pw_hash = self._hash_password(password)
        self.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?,?,?)",
            (username, pw_hash, role)
        )
        return self.fetchone("SELECT last_insert_rowid() as id")["id"]

    def update_user_password(self, user_id: int, new_password: str):
        self.execute(
            "UPDATE users SET password_hash=? WHERE id=?", (self._hash_password(new_password), user_id)
        )

    def update_user_role(self, user_id: int, role: str):
        self.execute("UPDATE users SET role=? WHERE id=?", (role, user_id))

    def set_user_active(self, user_id: int, active: bool):
        self.execute("UPDATE users SET active=? WHERE id=?", (1 if active else 0, user_id))

    def delete_user(self, user_id: int):
        self.execute("DELETE FROM users WHERE id=?", (user_id,))

    def record_login(self, user_id: int):
        self.execute("UPDATE users SET last_login=datetime('now') WHERE id=?", (user_id,))

    def verify_password(self, username: str, password: str) -> Optional[dict]:
        user = self.get_user(username)
        if not user:
            return None
        pw_hash = user["password_hash"]
        try:
            import bcrypt
            if pw_hash.startswith("sha256:"):
                import hashlib
                if "sha256:" + hashlib.sha256(password.encode()).hexdigest() == pw_hash:
                    self.update_user_password(user["id"], password)
                    self.record_login(user["id"])
                    return dict(user)
                return None
            if bcrypt.checkpw(password.encode(), pw_hash.encode()):
                self.record_login(user["id"])
                return dict(user)
        except Exception:
            pass
        return None

    @staticmethod
    def _hash_password(password: str) -> str:
        try:
            import bcrypt
            return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        except ImportError:
            import hashlib
            return "sha256:" + hashlib.sha256(password.encode()).hexdigest()

    # ── Audit log ─────────────────────────────────────────────
    def audit(self, username: str, action: str, details: str = "", user_id: int = None):
        self.execute(
            "INSERT INTO audit_log (user_id, username, action, details) VALUES (?,?,?,?)",
            (user_id, username, action, details)
        )

    def get_audit_log(self, limit: int = 200):
        return self.fetchall(
            "SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?", (limit,)
        )

    # ── Shifts ────────────────────────────────────────────────
    def get_shifts(self, active_only: bool = True):
        q = ("SELECT s.*, "
             "(SELECT COUNT(*) FROM shift_roster WHERE shift_id=s.id) as roster_count "
             "FROM shifts s")
        if active_only:
            q += " WHERE s.active=1"
        q += " ORDER BY s.start_time"
        return self.fetchall(q)

    def get_shift(self, shift_id: int):
        return self.fetchone("SELECT * FROM shifts WHERE id=?", (shift_id,))

    def add_shift(self, label: str, start_time: str, end_time: str, late_grace: int = 15) -> int:
        self.execute(
            "INSERT INTO shifts (label, start_time, end_time, late_grace_minutes) VALUES (?,?,?,?)",
            (label, start_time, end_time, late_grace)
        )
        return self.fetchone("SELECT last_insert_rowid() as id")["id"]

    def update_shift(self, shift_id: int, label: str, start_time: str,
                     end_time: str, late_grace: int):
        self.execute(
            "UPDATE shifts SET label=?, start_time=?, end_time=?, late_grace_minutes=? WHERE id=?",
            (label, start_time, end_time, late_grace, shift_id)
        )

    def delete_shift(self, shift_id: int):
        self.execute("DELETE FROM shifts WHERE id=?", (shift_id,))

    # ── Shift breaks ──────────────────────────────────────────
    def get_shift_breaks(self, shift_id: int):
        return self.fetchall(
            "SELECT * FROM shift_breaks WHERE shift_id=? ORDER BY start_time", (shift_id,)
        )

    def add_shift_break(self, shift_id: int, label: str, start_time: str, end_time: str):
        self.execute(
            "INSERT INTO shift_breaks (shift_id, label, start_time, end_time) VALUES (?,?,?,?)",
            (shift_id, label, start_time, end_time)
        )

    def delete_shift_breaks(self, shift_id: int):
        self.execute("DELETE FROM shift_breaks WHERE shift_id=?", (shift_id,))

    # ── Shift roster ──────────────────────────────────────────
    def get_shift_roster(self, shift_id: int):
        return self.fetchall("""
            SELECT e.id, e.name, e.employee_id, e.department
            FROM shift_roster sr JOIN employees e ON e.id = sr.employee_id
            WHERE sr.shift_id=? ORDER BY e.name
        """, (shift_id,))

    def assign_employee_to_shift(self, shift_id: int, employee_id: int):
        self.execute(
            "INSERT OR IGNORE INTO shift_roster (shift_id, employee_id) VALUES (?,?)",
            (shift_id, employee_id)
        )

    def remove_employee_from_shift(self, shift_id: int, employee_id: int):
        self.execute(
            "DELETE FROM shift_roster WHERE shift_id=? AND employee_id=?",
            (shift_id, employee_id)
        )

    def get_employee_shift(self, employee_id: int):
        return self.fetchone("""
            SELECT s.* FROM shifts s
            JOIN shift_roster sr ON sr.shift_id = s.id
            WHERE sr.employee_id=? AND s.active=1 LIMIT 1
        """, (employee_id,))

    # ── Weekly schedule ───────────────────────────────────────
    def set_weekly_schedule(self, shift_id: int, weekdays: List[int]):
        self.execute("DELETE FROM weekly_schedule WHERE shift_id=?", (shift_id,))
        for wd in weekdays:
            self.execute(
                "INSERT INTO weekly_schedule (shift_id, weekday) VALUES (?,?)", (shift_id, wd)
            )

    def get_weekly_schedule(self, shift_id: int) -> List[int]:
        rows = self.fetchall("SELECT weekday FROM weekly_schedule WHERE shift_id=?", (shift_id,))
        return [r["weekday"] for r in rows]

    # ── Off-days ──────────────────────────────────────────────
    def add_off_day(self, date_str: str, shift_id: int = None, note: str = ""):
        self.execute(
            "INSERT OR IGNORE INTO off_days (date, shift_id, note) VALUES (?,?,?)",
            (date_str, shift_id, note)
        )

    def remove_off_day(self, off_day_id: int):
        self.execute("DELETE FROM off_days WHERE id=?", (off_day_id,))

    def get_off_days(self, from_date: str = None, to_date: str = None):
        if from_date and to_date:
            return self.fetchall(
                "SELECT * FROM off_days WHERE date BETWEEN ? AND ? ORDER BY date",
                (from_date, to_date)
            )
        return self.fetchall("SELECT * FROM off_days ORDER BY date DESC")

    def is_off_day(self, date_str: str, shift_id: int = None) -> bool:
        row = self.fetchone(
            "SELECT 1 FROM off_days WHERE date=? AND (shift_id IS NULL OR shift_id=?) LIMIT 1",
            (date_str, shift_id if shift_id else -1)
        )
        return row is not None

    # ── Employees ─────────────────────────────────────────────
    def add_employee(self, name: str, emp_id: str, department: str = "", photo: str = "") -> int:
        self.execute(
            "INSERT INTO employees (name, employee_id, department, photo_path) VALUES (?,?,?,?)",
            (name, emp_id, department, photo)
        )
        return self.fetchone("SELECT last_insert_rowid() as id")["id"]

    def get_employees(self, active_only: bool = True):
        q = "SELECT * FROM employees"
        if active_only:
            q += " WHERE active=1"
        q += " ORDER BY name"
        return self.fetchall(q)

    def get_employee(self, emp_id: int):
        return self.fetchone("SELECT * FROM employees WHERE id=?", (emp_id,))

    def update_employee(self, emp_id: int, name: str = None,
                        employee_id: str = None, department: str = None):
        if name is not None:
            self.execute("UPDATE employees SET name=? WHERE id=?", (name, emp_id))
        if employee_id is not None:
            self.execute("UPDATE employees SET employee_id=? WHERE id=?", (employee_id, emp_id))
        if department is not None:
            self.execute("UPDATE employees SET department=? WHERE id=?", (department, emp_id))

    def update_calib_path(self, emp_id: int, path: str):
        self.execute("UPDATE employees SET calib_path=? WHERE id=?", (path, emp_id))

    def add_employee_photo(self, employee_id: int, path: str) -> int:
        self.execute(
            "INSERT INTO employee_photos (employee_id, path) VALUES (?,?)", (employee_id, path)
        )
        return self.fetchone("SELECT last_insert_rowid() as id")["id"]

    def get_employee_photos(self, employee_id: int):
        return self.fetchall(
            "SELECT id, path, created_at FROM employee_photos WHERE employee_id=? ORDER BY created_at",
            (employee_id,)
        )

    def delete_employee_photo(self, photo_id: int):
        self.execute("DELETE FROM employee_photos WHERE id=?", (photo_id,))

    def delete_employee_photos(self, employee_id: int):
        self.execute("DELETE FROM employee_photos WHERE employee_id=?", (employee_id,))

    def delete_employee(self, emp_id: int):
        for tbl in ("employee_photos", "attendance", "events", "daily_summary",
                    "sessions", "shift_roster"):
            self.execute(f"DELETE FROM {tbl} WHERE employee_id=?", (emp_id,))
        self.execute("DELETE FROM employees WHERE id=?", (emp_id,))

    def reset_all_data(self):
        for tbl in ("employee_photos", "attendance", "events", "daily_summary",
                    "sessions", "shift_roster", "alert_events"):
            self.execute(f"DELETE FROM {tbl}")
        self.execute("DELETE FROM employees")

    # ── Sessions ──────────────────────────────────────────────
    def start_session(self, employee_id: int, cam_index=0) -> int:
        now = datetime.now()
        self.execute(
            "INSERT INTO sessions (employee_id, date, start_time, cam_index) VALUES (?,?,?,?)",
            (employee_id, now.strftime("%Y-%m-%d"), now.isoformat(), cam_index)
        )
        return self.fetchone("SELECT last_insert_rowid() as id")["id"]

    def end_session(self, session_id: int):
        self.execute(
            "UPDATE sessions SET end_time=? WHERE id=?", (datetime.now().isoformat(), session_id)
        )

    # ── Events ────────────────────────────────────────────────
    def log_event_start(self, session_id: int, employee_id: int, event_type: str,
                        severity: str = "warning", notes: str = "") -> int:
        now = datetime.now().isoformat()
        self.execute(
            "INSERT INTO events (session_id, employee_id, event_type, started_at, severity, notes)"
            " VALUES (?,?,?,?,?,?)",
            (session_id, employee_id, event_type, now, severity, notes)
        )
        return self.fetchone("SELECT last_insert_rowid() as id")["id"]

    def update_event_image(self, event_id: int, image_path: str):
        self.execute("UPDATE events SET image_path=? WHERE id=?", (image_path, event_id))

    def log_event_end(self, event_id: int) -> float:
        row = self.fetchone("SELECT started_at FROM events WHERE id=?", (event_id,))
        if not row:
            return 0.0
        start = datetime.fromisoformat(row["started_at"])
        dur = (datetime.now() - start).total_seconds()
        self.execute(
            "UPDATE events SET ended_at=?, duration_sec=? WHERE id=?",
            (datetime.now().isoformat(), dur, event_id)
        )
        return dur

    def log_instant_event(self, session_id: int, employee_id: int, event_type: str,
                          severity: str = "info", notes: str = "") -> int:
        now = datetime.now().isoformat()
        self.execute(
            "INSERT INTO events (session_id, employee_id, event_type, started_at, ended_at,"
            " duration_sec, severity, notes) VALUES (?,?,?,?,?,0,?,?)",
            (session_id, employee_id, event_type, now, now, severity, notes)
        )
        return self.fetchone("SELECT last_insert_rowid() as id")["id"]

    # ── Daily summary ─────────────────────────────────────────
    def upsert_summary(self, employee_id: int, date_str: str, **kwargs):
        existing = self.fetchone(
            "SELECT * FROM daily_summary WHERE employee_id=? AND date=?",
            (employee_id, date_str)
        )
        if existing:
            cols = ", ".join(
                f"{k}={k}+?" if k != "productivity" else f"{k}=?"
                for k in kwargs
            )
            vals = list(kwargs.values()) + [employee_id, date_str]
            self.execute(
                f"UPDATE daily_summary SET {cols} WHERE employee_id=? AND date=?", vals
            )
        else:
            cols = ", ".join(["employee_id", "date"] + list(kwargs.keys()))
            placeholders = ", ".join(["?"] * (2 + len(kwargs)))
            self.execute(
                f"INSERT INTO daily_summary ({cols}) VALUES ({placeholders})",
                [employee_id, date_str] + list(kwargs.values())
            )

    def set_productivity(self, employee_id: int, date_str: str, score: float):
        self.execute(
            "UPDATE daily_summary SET productivity=? WHERE employee_id=? AND date=?",
            (score, employee_id, date_str)
        )

    def get_daily_summary(self, employee_id: int, date_str: str):
        return self.fetchone(
            "SELECT * FROM daily_summary WHERE employee_id=? AND date=?",
            (employee_id, date_str)
        )

    def get_summary_range(self, employee_id: int, days: int = 30):
        cutoff = (date.today() - timedelta(days=days)).isoformat()
        return self.fetchall(
            "SELECT * FROM daily_summary WHERE employee_id=? AND date>=? ORDER BY date",
            (employee_id, cutoff)
        )

    def get_events_for_day(self, employee_id: int, date_str: str):
        return self.fetchall(
            "SELECT * FROM events WHERE employee_id=? AND DATE(started_at)=? ORDER BY started_at",
            (employee_id, date_str)
        )

    def get_all_events_filtered(self, date_str: str = None, camera_id: int = None,
                                employee_id: int = None, event_type: str = None,
                                limit: int = 500):
        conditions, params = [], []
        if date_str:
            conditions.append("DATE(e.started_at)=?"); params.append(date_str)
        if camera_id is not None:
            conditions.append("s.cam_index=?");         params.append(camera_id)
        if employee_id is not None:
            conditions.append("e.employee_id=?");       params.append(employee_id)
        if event_type:
            conditions.append("e.event_type=?");        params.append(event_type)
        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        params.append(limit)
        return self.fetchall(f"""
            SELECT e.*, emp.name as emp_name, emp.employee_id as emp_code, s.cam_index
            FROM events e
            JOIN employees emp ON emp.id = e.employee_id
            LEFT JOIN sessions s ON s.id = e.session_id
            {where}
            ORDER BY e.started_at DESC LIMIT ?
        """, params)

    def get_all_employees_summary(self, date_str: str = None):
        if date_str is None:
            date_str = date.today().isoformat()
        return self.fetchall("""
            SELECT e.name, e.employee_id, e.department,
                   COALESCE(s.total_work_sec,0) as work,
                   COALESCE(s.sleep_sec,0)      as sleep,
                   COALESCE(s.phone_sec,0)      as phone,
                   COALESCE(s.absence_sec,0)    as absence,
                   COALESCE(s.productivity,100) as productivity
            FROM employees e
            LEFT JOIN daily_summary s ON s.employee_id=e.id AND s.date=?
            WHERE e.active=1 ORDER BY e.name
        """, (date_str,))

    # ── Attendance ────────────────────────────────────────────
    def log_attendance(self, employee_id: int, event_type: str, camera_id: int = 0,
                       image_path: str = "", status: str = "", shift_id: int = None) -> int:
        now = datetime.now().isoformat()
        self.execute(
            "INSERT INTO attendance (employee_id, camera_id, event_type, recognized_at,"
            " image_path, status, shift_id) VALUES (?,?,?,?,?,?,?)",
            (employee_id, camera_id, event_type, now, image_path, status, shift_id)
        )
        return self.fetchone("SELECT last_insert_rowid() as id")["id"]

    def get_last_attendance_time(self, employee_id: int) -> Optional[str]:
        row = self.fetchone(
            "SELECT recognized_at FROM attendance WHERE employee_id=? ORDER BY recognized_at DESC LIMIT 1",
            (employee_id,)
        )
        return row["recognized_at"] if row else None

    def get_first_attendance_today(self, employee_id: int, date_str: str):
        return self.fetchone(
            "SELECT * FROM attendance WHERE employee_id=? AND date(recognized_at)=?"
            " ORDER BY recognized_at ASC LIMIT 1",
            (employee_id, date_str)
        )

    def get_attendance_for_date(self, date_str: str):
        rows = self.fetchall("""
            SELECT a.id, a.employee_id, e.name, e.employee_id as emp_code, e.department,
                   a.event_type, a.recognized_at, a.camera_id, a.status, a.shift_id
            FROM attendance a JOIN employees e ON e.id = a.employee_id
            WHERE date(a.recognized_at) = ? ORDER BY a.recognized_at
        """, (date_str,))
        return [dict(r) for r in rows]

    def get_attendance_history(self, employee_id: int = None, days: int = 30):
        cutoff = (date.today() - timedelta(days=days)).isoformat()
        if employee_id is not None:
            return self.fetchall("""
                SELECT a.*, e.name, e.employee_id as emp_code
                FROM attendance a JOIN employees e ON e.id = a.employee_id
                WHERE a.employee_id=? AND date(a.recognized_at) >= ?
                ORDER BY a.recognized_at DESC
            """, (employee_id, cutoff))
        return self.fetchall("""
            SELECT a.*, e.name, e.employee_id as emp_code
            FROM attendance a JOIN employees e ON e.id = a.employee_id
            WHERE date(a.recognized_at) >= ? ORDER BY a.recognized_at DESC
        """, (cutoff,))

    # ── Alert events ──────────────────────────────────────────
    def log_alert_event(self, site_id: str, camera_id: str, employee_id: str,
                        employee_name: str, alert_type: str, severity: str,
                        shift_label: str = "", thumbnail_path: str = "") -> int:
        now = datetime.now().isoformat()
        self.execute(
            "INSERT INTO alert_events (site_id, camera_id, employee_id, employee_name,"
            " alert_type, severity, shift_label, thumbnail_path, timestamp)"
            " VALUES (?,?,?,?,?,?,?,?,?)",
            (site_id, camera_id, employee_id, employee_name, alert_type,
             severity, shift_label, thumbnail_path, now)
        )
        return self.fetchone("SELECT last_insert_rowid() as id")["id"]

    def mark_alert_published(self, alert_id: int, mqtt: bool = False, redis: bool = False):
        if mqtt:
            self.execute("UPDATE alert_events SET mqtt_published=1 WHERE id=?", (alert_id,))
        if redis:
            self.execute("UPDATE alert_events SET redis_published=1 WHERE id=?", (alert_id,))

    def get_unpublished_alerts(self, limit: int = 50):
        return self.fetchall(
            "SELECT * FROM alert_events WHERE mqtt_published=0 OR redis_published=0"
            " ORDER BY timestamp LIMIT ?", (limit,)
        )

    # ── KPI ───────────────────────────────────────────────────
    def get_present_count_today(self) -> int:
        today = date.today().isoformat()
        row = self.fetchone(
            "SELECT COUNT(DISTINCT employee_id) as cnt FROM attendance WHERE date(recognized_at)=?",
            (today,)
        )
        return row["cnt"] if row else 0

    def get_alert_type_counts_today(self) -> Dict[str, int]:
        today = date.today().isoformat()
        rows = self.fetchall(
            "SELECT alert_type, COUNT(*) as cnt FROM alert_events WHERE date(timestamp)=?"
            " GROUP BY alert_type",
            (today,)
        )
        return {r["alert_type"]: r["cnt"] for r in rows}

    def get_top_alert_today(self) -> str:
        counts = self.get_alert_type_counts_today()
        return max(counts, key=counts.get) if counts else "—"


# ── Singleton ─────────────────────────────────────────────────
_db: Optional[Database] = None


def get_db() -> Database:
    global _db
    if _db is None:
        _db = Database()
    return _db
