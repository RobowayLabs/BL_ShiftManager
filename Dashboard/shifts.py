# ============================================================
#  shifts.py  —  Shift boundary detection & break suppression
#  Handles midnight-spanning night shifts correctly (FR-6)
# ============================================================
import logging
from datetime import datetime, date, timedelta, time as dtime
from typing import Optional, Tuple, Dict, List

logger = logging.getLogger(__name__)

# Attendance status constants
STATUS_PRESENT          = "present"
STATUS_LATE             = "late"
STATUS_ABSENT           = "absent"
STATUS_EARLY_DEPARTURE  = "early_departure"


def _parse_hhmm(hhmm: str) -> dtime:
    """Parse 'HH:MM' string into datetime.time."""
    h, m = map(int, hhmm.strip().split(":"))
    return dtime(h, m)


def _shift_window(shift_start: str, shift_end: str, ref_dt: datetime) -> Tuple[datetime, datetime]:
    """Compute absolute datetime window for a shift anchored to ref_dt's calendar date.

    Handles midnight-spanning shifts (e.g. 22:00 → 06:00) by advancing the end
    date by 1 day when end_time < start_time.

    Returns (window_start, window_end) as datetime objects.
    """
    d = ref_dt.date()
    s_time = _parse_hhmm(shift_start)
    e_time = _parse_hhmm(shift_end)
    window_start = datetime.combine(d, s_time)
    if e_time <= s_time:                       # midnight-spanning shift
        window_end = datetime.combine(d + timedelta(days=1), e_time)
    else:
        window_end = datetime.combine(d, e_time)
    return window_start, window_end


def get_active_shift(now: datetime = None) -> Optional[dict]:
    """Return the shift that is currently active at *now*, or None.

    Checks both the previous calendar day (for night shifts that started
    yesterday) and today.
    """
    from database import get_db
    db = get_db()
    if now is None:
        now = datetime.now()
    shifts = db.get_shifts(active_only=True)
    for shift in shifts:
        for delta_days in (0, -1):          # check today and yesterday anchor
            anchor = now + timedelta(days=delta_days)
            ws, we = _shift_window(shift["start_time"], shift["end_time"], anchor)
            if ws <= now < we:
                return dict(shift)
    return None


def get_shift_for_employee(employee_id: int, now: datetime = None) -> Optional[dict]:
    """Return the shift assigned to *employee_id* if that shift is currently active."""
    from database import get_db
    db = get_db()
    shift = db.get_employee_shift(employee_id)
    if not shift:
        return None
    if now is None:
        now = datetime.now()
    for delta_days in (0, -1):
        anchor = now + timedelta(days=delta_days)
        ws, we = _shift_window(shift["start_time"], shift["end_time"], anchor)
        if ws <= now < we:
            return dict(shift)
    return None


def is_in_break(shift_id: int, now: datetime = None) -> bool:
    """Return True if *now* falls within any configured break window for *shift_id*.

    Breaks are evaluated relative to the shift's calendar anchor (handles
    shifts that cross midnight).
    """
    from database import get_db
    db = get_db()
    breaks = db.get_shift_breaks(shift_id)
    if not breaks:
        return False
    if now is None:
        now = datetime.now()
    for brk in breaks:
        bs = _parse_hhmm(brk["start_time"])
        be = _parse_hhmm(brk["end_time"])
        brk_start = datetime.combine(now.date(), bs)
        if be <= bs:  # midnight-spanning break
            brk_end = datetime.combine(now.date() + timedelta(days=1), be)
        else:
            brk_end = datetime.combine(now.date(), be)
        if brk_start <= now < brk_end:
            return True
    return False


def should_suppress_alert(employee_id: int, now: datetime = None) -> Tuple[bool, str]:
    """Determine whether alerts should be suppressed for an employee.

    Returns (suppressed: bool, reason: str).
    Suppression reasons: 'break', 'off_day', 'outside_shift', 'no_shift'
    """
    from database import get_db
    db = get_db()
    if now is None:
        now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")

    shift = get_shift_for_employee(employee_id, now)

    # If no shift assigned, fall back to any currently active shift
    if shift is None:
        # Check if any shift is active (employee might not be in roster)
        active = get_active_shift(now)
        if active is None:
            return True, "outside_shift"
        shift = active

    # Off-day check
    if db.is_off_day(date_str, shift["id"]) or db.is_off_day(date_str, None):
        return True, "off_day"

    # Break check
    if is_in_break(shift["id"], now):
        return True, "break"

    return False, ""


def classify_attendance_status(employee_id: int, recognized_at: datetime) -> Tuple[str, Optional[int]]:
    """Classify an attendance recognition as 'present', 'late', or 'early_departure'.

    Returns (status, shift_id).
    """
    from database import get_db
    db = get_db()
    shift = get_shift_for_employee(employee_id, recognized_at)
    if not shift:
        return STATUS_PRESENT, None   # no shift = mark present by default

    shift_id = shift["id"]
    date_str = recognized_at.strftime("%Y-%m-%d")

    # Check for first recognition of the day (= In-Time)
    first = db.get_first_attendance_today(employee_id, date_str)
    is_first = (first is None)

    if is_first:
        for delta_days in (0, -1):
            anchor = recognized_at + timedelta(days=delta_days)
            ws, we = _shift_window(shift["start_time"], shift["end_time"], anchor)
            if ws <= recognized_at < we:
                grace_sec = shift.get("late_grace_minutes", 15) * 60
                if (recognized_at - ws).total_seconds() > grace_sec:
                    return STATUS_LATE, shift_id
                return STATUS_PRESENT, shift_id
        return STATUS_PRESENT, shift_id
    else:
        # Subsequent recognitions — check if near shift end (Out-Time / Early Departure)
        for delta_days in (0, -1):
            anchor = recognized_at + timedelta(days=delta_days)
            ws, we = _shift_window(shift["start_time"], shift["end_time"], anchor)
            if ws <= recognized_at < we:
                time_remaining = (we - recognized_at).total_seconds()
                if time_remaining < 30 * 60:        # within 30 min of shift end
                    return STATUS_EARLY_DEPARTURE, shift_id
                return STATUS_PRESENT, shift_id
        return STATUS_PRESENT, shift_id


def get_shift_summary_for_date(date_str: str) -> List[dict]:
    """Build a per-shift attendance summary for the given date."""
    from database import get_db
    db = get_db()
    shifts = db.get_shifts(active_only=True)
    result = []
    att = db.get_attendance_for_date(date_str)
    for shift in shifts:
        roster = db.get_shift_roster(shift["id"])
        emp_ids = {r["id"] for r in roster}
        present = {r["employee_id"] for r in att
                   if r.get("shift_id") == shift["id"] or r["employee_id"] in emp_ids}
        result.append({
            "shift_id":    shift["id"],
            "shift_label": shift["label"],
            "total":       len(emp_ids),
            "present":     len(present),
            "absent":      len(emp_ids - {r["employee_id"] for r in att}),
            "completion":  round(len(present) / len(emp_ids) * 100, 1) if emp_ids else 0.0,
        })
    return result
