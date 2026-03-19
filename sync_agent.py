#!/usr/bin/env python3
"""
sync_agent.py — Bidirectional sync between local SQLite (sentinel.db) and MongoDB (web backend).

Run alongside the PyQt5 desktop app:
    python sync_agent.py

Sync directions:
  Desktop → MongoDB:  employees (new + updates), attendance, alert_events, daily_summary
  MongoDB → Desktop:  shift_assignments, shifts (definitions)

State tracking: ./sync_state.json  (last_synced timestamps per table)
Concurrency:    push operations run in parallel threads; SQLite uses WAL mode + busy timeout
"""

import sqlite3
import requests
import json
import time
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

API_BASE          = "https://bl-shift-manager.vercel.app/api/sync"
API_KEY           = "bl-sync-key-change-me-in-production"  # must match server .env SYNC_API_KEY
SQLITE_PATH       = "./sentinel.db"
STATE_FILE        = "./sync_state.json"
POLL_INTERVAL_SEC = 30
SQLITE_RETRIES    = 3
SQLITE_RETRY_DELAY = 0.5   # seconds; multiplied by attempt number

HEADERS = {
    "Content-Type": "application/json",
    "X-API-Key": API_KEY,
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [sync_agent] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("sync_agent")

# ── Thread-safe state ─────────────────────────────────────────────────────────

_state_lock = threading.Lock()

def load_state() -> dict:
    with _state_lock:
        if Path(STATE_FILE).exists():
            try:
                return json.loads(Path(STATE_FILE).read_text())
            except Exception:
                pass
        return {}

def save_state(state: dict):
    with _state_lock:
        Path(STATE_FILE).write_text(json.dumps(state, indent=2))

def update_state_key(key: str, value: str):
    """Thread-safe update of a single state key."""
    with _state_lock:
        try:
            current = json.loads(Path(STATE_FILE).read_text()) if Path(STATE_FILE).exists() else {}
        except Exception:
            current = {}
        current[key] = value
        Path(STATE_FILE).write_text(json.dumps(current, indent=2))

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

# ── SQLite helper with WAL mode + retry ───────────────────────────────────────

def get_db():
    """Open SQLite with WAL journal mode and a 5 s busy timeout."""
    conn = sqlite3.connect(SQLITE_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn

def sqlite_read(query: str, params: tuple = ()) -> list:
    """Execute a SELECT with automatic retry on locked errors."""
    for attempt in range(SQLITE_RETRIES):
        try:
            conn = get_db()
            rows = conn.execute(query, params).fetchall()
            conn.close()
            return rows
        except sqlite3.OperationalError as e:
            if "locked" in str(e).lower() and attempt < SQLITE_RETRIES - 1:
                delay = SQLITE_RETRY_DELAY * (attempt + 1)
                log.warning(f"SQLite locked, retrying in {delay:.1f}s (attempt {attempt + 1})")
                time.sleep(delay)
            else:
                raise
    return []

def sqlite_write(query: str, params: tuple = (), many: list = None):
    """Execute an INSERT/UPDATE with automatic retry on locked errors."""
    for attempt in range(SQLITE_RETRIES):
        try:
            conn = get_db()
            if many is not None:
                conn.executemany(query, many)
            else:
                conn.execute(query, params)
            conn.commit()
            conn.close()
            return
        except sqlite3.OperationalError as e:
            if "locked" in str(e).lower() and attempt < SQLITE_RETRIES - 1:
                delay = SQLITE_RETRY_DELAY * (attempt + 1)
                log.warning(f"SQLite locked on write, retrying in {delay:.1f}s (attempt {attempt + 1})")
                time.sleep(delay)
            else:
                raise

# ── Push: Desktop → MongoDB ───────────────────────────────────────────────────

def push_employees():
    """Push ALL employees every cycle (upsert by employeeId — handles new + updates)."""
    try:
        rows = sqlite_read("SELECT id, name, employee_id, department, active FROM employees")
        if not rows:
            return

        employees = [
            {
                "employeeId": r["employee_id"],
                "name": r["name"],
                "department": r["department"] or "Unassigned",
                "active": bool(r["active"]),
            }
            for r in rows
        ]

        resp = requests.post(
            f"{API_BASE}/employees",
            headers=HEADERS,
            json={"employees": employees},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        log.info(f"[employees] pushed {data.get('processed', 0)} records")
    except Exception as e:
        log.error(f"[employees] push failed: {e}")


def push_attendance():
    """Push attendance events newer than last_synced (thread-safe state update)."""
    with _state_lock:
        try:
            current = json.loads(Path(STATE_FILE).read_text()) if Path(STATE_FILE).exists() else {}
        except Exception:
            current = {}
        last = current.get("attendance_last_synced", "1970-01-01 00:00:00")

    try:
        rows = sqlite_read(
            """SELECT a.id, e.employee_id, a.event_type, a.recognized_at
               FROM attendance a
               JOIN employees e ON e.id = a.employee_id
               WHERE a.recognized_at > ?
               ORDER BY a.recognized_at ASC
               LIMIT 500""",
            (last,),
        )
        if not rows:
            return

        events = [
            {
                "employeeId": r["employee_id"],
                "cameraId": "cam-01",
                "eventType": r["event_type"],
                "recognizedAt": r["recognized_at"],
            }
            for r in rows
        ]

        resp = requests.post(
            f"{API_BASE}/attendance",
            headers=HEADERS,
            json={"attendance": events},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        log.info(f"[attendance] pushed {data.get('processed', 0)} events (since {last})")
        update_state_key("attendance_last_synced", rows[-1]["recognized_at"])
    except Exception as e:
        log.error(f"[attendance] push failed: {e}")


def push_alerts():
    """Push alert_events newer than last_synced (thread-safe state update)."""
    with _state_lock:
        try:
            current = json.loads(Path(STATE_FILE).read_text()) if Path(STATE_FILE).exists() else {}
        except Exception:
            current = {}
        last = current.get("alerts_last_synced", "1970-01-01 00:00:00")

    try:
        rows = sqlite_read(
            """SELECT id, alert_type, severity, camera_id, employee_id, employee_name,
                      shift_label, timestamp
               FROM alert_events
               WHERE timestamp > ?
               ORDER BY timestamp ASC
               LIMIT 500""",
            (last,),
        )
        if not rows:
            return

        alerts = [
            {
                "localId": str(r["id"]),
                "employeeId": r["employee_id"] or "",
                "employeeName": r["employee_name"] or "",
                "cameraId": r["camera_id"] or "",
                "alertType": r["alert_type"],
                "severity": r["severity"] or "medium",
                "shiftLabel": r["shift_label"] or "",
                "timestamp": r["timestamp"],
                "message": f"{r['alert_type']} detected: {r['employee_name'] or r['employee_id'] or 'Unknown'}",
            }
            for r in rows
        ]

        resp = requests.post(
            f"{API_BASE}/alerts",
            headers=HEADERS,
            json={"alerts": alerts},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        log.info(f"[alerts] pushed {data.get('processed', 0)}, skipped {data.get('skipped', 0)} (since {last})")
        update_state_key("alerts_last_synced", rows[-1]["timestamp"])
    except Exception as e:
        log.error(f"[alerts] push failed: {e}")


def push_daily_summary():
    """Push daily_summary rows updated since last sync (thread-safe state update)."""
    with _state_lock:
        try:
            current = json.loads(Path(STATE_FILE).read_text()) if Path(STATE_FILE).exists() else {}
        except Exception:
            current = {}
        last = current.get("daily_summary_last_synced", "1970-01-01")

    try:
        rows = sqlite_read(
            """SELECT e.employee_id, ds.date, ds.total_work_sec, ds.sleep_sec, ds.drowsy_sec,
                      ds.phone_sec, ds.phone_count, ds.absence_sec, ds.productivity
               FROM daily_summary ds
               JOIN employees e ON e.id = ds.employee_id
               WHERE ds.date >= ?
               ORDER BY ds.date ASC
               LIMIT 500""",
            (last,),
        )
        if not rows:
            return

        summaries = [
            {
                "employeeId": r["employee_id"],
                "date": r["date"],
                "totalWorkSec": r["total_work_sec"] or 0,
                "sleepSec": r["sleep_sec"] or 0,
                "drowsySec": r["drowsy_sec"] or 0,
                "yawnCount": 0,
                "phoneSec": r["phone_sec"] or 0,
                "phoneCount": r["phone_count"] or 0,
                "absenceSec": r["absence_sec"] or 0,
                "productivity": r["productivity"] or 0,
                "syncedAt": now_iso(),
            }
            for r in rows
        ]

        resp = requests.post(
            f"{API_BASE}/daily-summary",
            headers=HEADERS,
            json={"summaries": summaries},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        log.info(f"[daily_summary] pushed {data.get('processed', 0)} records")
        if rows:
            update_state_key("daily_summary_last_synced", rows[-1]["date"])
    except Exception as e:
        log.error(f"[daily_summary] push failed: {e}")


# ── Pull: MongoDB → Desktop ───────────────────────────────────────────────────

def pull_shift_assignments():
    """Pull shift assignments from MongoDB and upsert into SQLite."""
    with _state_lock:
        try:
            current = json.loads(Path(STATE_FILE).read_text()) if Path(STATE_FILE).exists() else {}
        except Exception:
            current = {}
        last = current.get("shifts_last_pulled", "1970-01-01T00:00:00Z")

    try:
        resp = requests.get(
            f"{API_BASE}/shifts",
            headers=HEADERS,
            params={"updatedSince": last},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        shifts = data.get("shifts", [])

        if not shifts:
            update_state_key("shifts_last_pulled", now_iso())
            return

        conn = get_db()
        inserted = 0
        for s in shifts:
            shift_row = conn.execute(
                "SELECT id FROM shifts WHERE label = ?", (s["type"],)
            ).fetchone()
            if not shift_row:
                log.warning(f"[shifts] unknown shift type {s['type']}, skipping")
                continue

            emp_row = conn.execute(
                "SELECT id FROM employees WHERE employee_id = ?", (s["employeeId"],)
            ).fetchone()
            if not emp_row:
                log.warning(f"[shifts] employee {s['employeeId']} not in local DB, skipping")
                continue

            conn.execute(
                """INSERT INTO shift_assignments (employee_id, shift_id, date, status)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(employee_id, shift_id, date) DO UPDATE SET
                     status = excluded.status""",
                (emp_row["id"], shift_row["id"], s["date"], s.get("status", "Scheduled"))
            )
            inserted += 1

        conn.commit()
        conn.close()
        log.info(f"[shifts] pulled {len(shifts)}, upserted {inserted}")
        update_state_key("shifts_last_pulled", now_iso())
    except Exception as e:
        log.error(f"[shifts] pull failed: {e}")


# ── Main loop ─────────────────────────────────────────────────────────────────

PUSH_TASKS = {
    "employees":     push_employees,
    "attendance":    push_attendance,
    "alerts":        push_alerts,
    "daily_summary": push_daily_summary,
}

def main():
    log.info(f"Sync agent started — polling every {POLL_INTERVAL_SEC}s")
    log.info(f"API: {API_BASE}")
    log.info(f"SQLite: {SQLITE_PATH}")

    if not Path(SQLITE_PATH).exists():
        log.error(f"SQLite database not found at {SQLITE_PATH}. Exiting.")
        return

    while True:
        # Run all push operations concurrently
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = {executor.submit(fn): name for name, fn in PUSH_TASKS.items()}
            for future in as_completed(futures):
                name = futures[future]
                try:
                    future.result()
                except Exception as e:
                    log.error(f"[{name}] unhandled error: {e}")

        # Pull runs after all pushes complete (employees must exist in SQLite first)
        pull_shift_assignments()

        time.sleep(POLL_INTERVAL_SEC)


if __name__ == "__main__":
    main()
