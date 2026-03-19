# ============================================================
#  ui/shift_dialog.py  —  Shift management dialog (FR-6)
#  Create/edit shifts, configure breaks and rosters
# ============================================================
from PyQt5.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QFormLayout, QGroupBox,
    QLabel, QLineEdit, QPushButton, QTableWidget, QTableWidgetItem,
    QComboBox, QSpinBox, QMessageBox, QHeaderView,
    QListWidget, QListWidgetItem, QTabWidget, QWidget, QDateEdit,
    QSizePolicy
)
from PyQt5.QtCore import Qt, QDate
from PyQt5.QtGui import QColor

_BTN_PRIMARY = ("background:#1f6feb; color:#fff; border-radius:4px;"
                " padding:3px 12px; border:none;")
_BTN_DANGER  = ("color:#f85149; border:1px solid #f85149; border-radius:4px;"
                " padding:3px 8px; background:transparent;")


# ── Shift Editor Dialog ───────────────────────────────────────────────────────
class ShiftEditorDialog(QDialog):
    """Create or edit a single shift with breaks and roster."""

    def __init__(self, parent=None, shift=None, db=None):
        super().__init__(parent)
        from database import get_db
        self._db    = db or get_db()
        self._shift = shift
        sid = shift["id"] if shift else None
        self.setWindowTitle("Edit Shift" if shift else "New Shift")
        self.setMinimumSize(660, 560)
        self.resize(700, 580)
        self._build_ui(sid)

    # ── UI ────────────────────────────────────────────────────────────────────
    def _build_ui(self, shift_id):
        root = QVBoxLayout(self)
        root.setSpacing(8)
        tabs = QTabWidget()

        # Tab 1 – Basics ───────────────────────────────────────────────────
        basics = QWidget()
        form = QFormLayout(basics)
        form.setLabelAlignment(Qt.AlignRight)
        form.setSpacing(10)
        form.setContentsMargins(18, 16, 18, 16)

        self.label_edit = QLineEdit(self._shift["label"] if self._shift else "")
        self.label_edit.setPlaceholderText("e.g. Morning")
        self.start_edit = QLineEdit(self._shift["start_time"] if self._shift else "08:00")
        self.start_edit.setPlaceholderText("HH:MM")
        self.end_edit   = QLineEdit(self._shift["end_time"]   if self._shift else "16:00")
        self.end_edit.setPlaceholderText("HH:MM")
        self.grace_spin = QSpinBox()
        self.grace_spin.setRange(0, 120)
        self.grace_spin.setSuffix(" min")
        self.grace_spin.setValue(
            self._shift["late_grace_minutes"] if self._shift else 15
        )
        self.grace_spin.setToolTip(
            "Employees recognised within this window after shift start\n"
            "are still marked 'Present' (not 'Late')."
        )

        for w in (self.label_edit, self.start_edit, self.end_edit):
            w.setMinimumHeight(30)

        form.addRow("Shift Label:",        self.label_edit)
        form.addRow("Start Time (HH:MM):", self.start_edit)
        form.addRow("End Time (HH:MM):",   self.end_edit)
        form.addRow("Late Grace Period:",  self.grace_spin)

        note = QLabel(
            "\u2139  Night shifts that cross midnight are handled automatically.\n"
            "    Example: 22:00 \u2192 06:00 spans two calendar days."
        )
        note.setStyleSheet("color:#4a7a8a; font-size:10px; padding:6px 0 0 0;")
        form.addRow(note)
        tabs.addTab(basics, "Basics")

        # Tab 2 – Breaks ───────────────────────────────────────────────────
        breaks_w = QWidget()
        bl = QVBoxLayout(breaks_w)
        bl.setContentsMargins(8, 8, 8, 8)
        bl.setSpacing(6)

        brk_btns = QHBoxLayout()
        add_brk = QPushButton("\u002b Add Break")
        add_brk.setStyleSheet(_BTN_PRIMARY)
        # Use explicit lambda() so Qt's checked-bool is never forwarded
        add_brk.clicked.connect(lambda: self._add_break_row())
        rm_brk = QPushButton("Remove Selected")
        rm_brk.setStyleSheet(_BTN_DANGER)
        rm_brk.clicked.connect(self._remove_break_row)
        brk_btns.addWidget(add_brk)
        brk_btns.addWidget(rm_brk)
        brk_btns.addStretch()
        bl.addLayout(brk_btns)

        self.break_table = QTableWidget(0, 3)
        self.break_table.setHorizontalHeaderLabels(
            ["Label", "Start (HH:MM)", "End (HH:MM)"]
        )
        self.break_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self.break_table.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeToContents
        )
        self.break_table.horizontalHeader().setSectionResizeMode(
            2, QHeaderView.ResizeToContents
        )
        self.break_table.setAlternatingRowColors(True)
        self.break_table.verticalHeader().setDefaultSectionSize(32)
        bl.addWidget(self.break_table)
        tabs.addTab(breaks_w, "Breaks")

        # Tab 3 – Roster ───────────────────────────────────────────────────
        roster_w = QWidget()
        rl = QHBoxLayout(roster_w)
        rl.setContentsMargins(8, 8, 8, 8)
        rl.setSpacing(8)

        left_grp  = QGroupBox("All Employees")
        right_grp = QGroupBox("Assigned to This Shift")
        ll  = QVBoxLayout(left_grp)
        rl2 = QVBoxLayout(right_grp)

        self.all_emp_list   = QListWidget()
        self.shift_emp_list = QListWidget()
        for lw in (self.all_emp_list, self.shift_emp_list):
            lw.setSelectionMode(QListWidget.ExtendedSelection)
        ll.addWidget(self.all_emp_list)
        rl2.addWidget(self.shift_emp_list)

        mid = QVBoxLayout()
        mid.setSpacing(6)
        assign_btn   = QPushButton("\u2192 Assign")
        unassign_btn = QPushButton("\u2190 Remove")
        assign_btn.setStyleSheet(_BTN_PRIMARY)
        unassign_btn.setStyleSheet(_BTN_DANGER)
        assign_btn.clicked.connect(self._assign_emp)
        unassign_btn.clicked.connect(self._unassign_emp)
        mid.addStretch()
        mid.addWidget(assign_btn)
        mid.addWidget(unassign_btn)
        mid.addStretch()

        rl.addWidget(left_grp, 1)
        rl.addLayout(mid)
        rl.addWidget(right_grp, 1)
        tabs.addTab(roster_w, "Roster")

        root.addWidget(tabs)

        # Dialog buttons ───────────────────────────────────────────────────
        btn_row = QHBoxLayout()
        save_btn   = QPushButton("\u2714  Save Shift")
        cancel_btn = QPushButton("Cancel")
        save_btn.setStyleSheet(_BTN_PRIMARY + " font-weight:bold; padding:5px 18px;")
        save_btn.clicked.connect(self._save)
        cancel_btn.clicked.connect(self.reject)
        btn_row.addStretch()
        btn_row.addWidget(save_btn)
        btn_row.addWidget(cancel_btn)
        root.addLayout(btn_row)

        # Populate existing data ───────────────────────────────────────────
        if shift_id:
            for brk in self._db.get_shift_breaks(shift_id):
                self._add_break_row(brk["label"], brk["start_time"], brk["end_time"])
            assigned = {r["id"] for r in self._db.get_shift_roster(shift_id)}
        else:
            assigned = set()

        for emp in self._db.get_employees(active_only=True):
            item = QListWidgetItem(f"{emp['name']}  ({emp['employee_id']})")
            item.setData(Qt.UserRole, emp["id"])
            (self.shift_emp_list if emp["id"] in assigned else self.all_emp_list).addItem(item)

    # ── Helpers ───────────────────────────────────────────────────────────────
    def _add_break_row(self, label="Lunch", start="12:00", end="13:00"):
        """Add an editable break row.  Coerces any non-str args (e.g. the
        bool emitted by QPushButton.clicked) to safe defaults."""
        label = label if isinstance(label, str) else "Lunch"
        start = start if isinstance(start, str) else "12:00"
        end   = end   if isinstance(end,   str) else "13:00"

        r = self.break_table.rowCount()
        self.break_table.insertRow(r)

        for col, (text, ph) in enumerate([
            (label, "e.g. Lunch"),
            (start, "HH:MM"),
            (end,   "HH:MM"),
        ]):
            ed = QLineEdit(text)
            ed.setPlaceholderText(ph)
            ed.setFrame(False)
            self.break_table.setCellWidget(r, col, ed)

    def _remove_break_row(self):
        row = self.break_table.currentRow()
        if row < 0:
            row = self.break_table.rowCount() - 1
        if row >= 0:
            self.break_table.removeRow(row)

    def _assign_emp(self):
        for item in list(self.all_emp_list.selectedItems()):
            self.all_emp_list.takeItem(self.all_emp_list.row(item))
            self.shift_emp_list.addItem(item)

    def _unassign_emp(self):
        for item in list(self.shift_emp_list.selectedItems()):
            self.shift_emp_list.takeItem(self.shift_emp_list.row(item))
            self.all_emp_list.addItem(item)

    def _save(self):
        label = self.label_edit.text().strip()
        start = self.start_edit.text().strip()
        end   = self.end_edit.text().strip()
        grace = self.grace_spin.value()

        if not label or not start or not end:
            QMessageBox.warning(self, "Validation",
                                "Shift Label, Start Time, and End Time are required.")
            return

        for t in (start, end):
            try:
                h, m = map(int, t.split(":"))
                assert 0 <= h <= 23 and 0 <= m <= 59
            except Exception:
                QMessageBox.warning(self, "Invalid Time",
                                    f"'{t}' is not a valid 24-hour HH:MM time.")
                return

        if self._shift:
            self._db.update_shift(self._shift["id"], label, start, end, grace)
            shift_id = self._shift["id"]
            self._db.delete_shift_breaks(shift_id)
        else:
            shift_id = self._db.add_shift(label, start, end, grace)

        for r in range(self.break_table.rowCount()):
            lw = self.break_table.cellWidget(r, 0)
            sw = self.break_table.cellWidget(r, 1)
            ew = self.break_table.cellWidget(r, 2)
            if lw and sw and ew:
                lv, sv, ev = lw.text().strip(), sw.text().strip(), ew.text().strip()
                if lv and sv and ev:
                    self._db.add_shift_break(shift_id, lv, sv, ev)

        for emp in self._db.get_employees(active_only=True):
            self._db.remove_employee_from_shift(shift_id, emp["id"])
        for i in range(self.shift_emp_list.count()):
            emp_id = self.shift_emp_list.item(i).data(Qt.UserRole)
            self._db.assign_employee_to_shift(shift_id, emp_id)

        self.accept()


# ── Shift Management Dialog ───────────────────────────────────────────────────
class ShiftManagementDialog(QDialog):
    """Top-level shift management: list, add, edit, delete shifts + off-days."""

    def __init__(self, parent=None):
        super().__init__(parent)
        from database import get_db
        self._db = get_db()
        self.setWindowTitle("Shift & Schedule Management")
        self.setMinimumSize(740, 560)
        self.resize(800, 600)
        self._build_ui()
        self._load_shifts()
        self._load_off_days()

    def _build_ui(self):
        layout = QVBoxLayout(self)
        layout.setSpacing(6)
        tabs = QTabWidget()

        # Shifts tab ───────────────────────────────────────────────────────
        shifts_w = QWidget()
        sl = QVBoxLayout(shifts_w)
        sl.setContentsMargins(8, 8, 8, 8)

        ctrl = QHBoxLayout()
        add_btn = QPushButton("\u002b New Shift")
        add_btn.setStyleSheet(_BTN_PRIMARY + " padding:5px 14px;")
        add_btn.clicked.connect(self._add_shift)
        ctrl.addWidget(add_btn)
        ctrl.addStretch()
        sl.addLayout(ctrl)

        self.shift_table = QTableWidget(0, 5)
        self.shift_table.setHorizontalHeaderLabels(
            ["Shift Label", "Start", "End", "Roster", "Actions"]
        )
        hh = self.shift_table.horizontalHeader()
        hh.setSectionResizeMode(0, QHeaderView.Stretch)
        hh.setSectionResizeMode(1, QHeaderView.ResizeToContents)
        hh.setSectionResizeMode(2, QHeaderView.ResizeToContents)
        hh.setSectionResizeMode(3, QHeaderView.ResizeToContents)
        hh.setSectionResizeMode(4, QHeaderView.Fixed)
        self.shift_table.setColumnWidth(4, 160)
        self.shift_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.shift_table.setAlternatingRowColors(True)
        self.shift_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.shift_table.verticalHeader().setDefaultSectionSize(36)
        sl.addWidget(self.shift_table)
        tabs.addTab(shifts_w, "Shifts")

        # Off-days tab ─────────────────────────────────────────────────────
        off_w = QWidget()
        ol = QVBoxLayout(off_w)
        ol.setContentsMargins(8, 8, 8, 8)
        ol.setSpacing(8)

        add_grp = QGroupBox("Add Off-Day")
        oform = QHBoxLayout(add_grp)
        oform.setSpacing(8)

        self.offday_date = QDateEdit()
        self.offday_date.setCalendarPopup(True)
        self.offday_date.setDate(QDate.currentDate())
        self.offday_date.setMinimumWidth(110)

        self.offday_shift = QComboBox()
        self.offday_shift.setMinimumWidth(120)
        self.offday_shift.addItem("All Shifts", None)
        for s in self._db.get_shifts(active_only=False):
            self.offday_shift.addItem(s["label"], s["id"])

        self.offday_note = QLineEdit()
        self.offday_note.setPlaceholderText("Note (optional)")

        add_off_btn = QPushButton("Add")
        add_off_btn.setStyleSheet(_BTN_PRIMARY + " padding:4px 16px;")
        add_off_btn.clicked.connect(self._add_off_day)

        oform.addWidget(QLabel("Date:"))
        oform.addWidget(self.offday_date)
        oform.addWidget(QLabel("Applies to:"))
        oform.addWidget(self.offday_shift)
        oform.addWidget(QLabel("Note:"))
        oform.addWidget(self.offday_note, 1)
        oform.addWidget(add_off_btn)
        ol.addWidget(add_grp)

        self.offday_table = QTableWidget(0, 4)
        self.offday_table.setHorizontalHeaderLabels(["Date", "Shift", "Note", ""])
        oh = self.offday_table.horizontalHeader()
        oh.setSectionResizeMode(0, QHeaderView.ResizeToContents)
        oh.setSectionResizeMode(1, QHeaderView.ResizeToContents)
        oh.setSectionResizeMode(2, QHeaderView.Stretch)
        oh.setSectionResizeMode(3, QHeaderView.Fixed)
        self.offday_table.setColumnWidth(3, 90)
        self.offday_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.offday_table.setAlternatingRowColors(True)
        self.offday_table.verticalHeader().setDefaultSectionSize(34)
        ol.addWidget(self.offday_table)
        tabs.addTab(off_w, "Off-Days")

        layout.addWidget(tabs)

        close_btn = QPushButton("Close")
        close_btn.setMinimumWidth(90)
        close_btn.clicked.connect(self.accept)
        layout.addWidget(close_btn, alignment=Qt.AlignRight)

    # ── Data loaders ──────────────────────────────────────────────────────────
    def _load_shifts(self):
        shifts = self._db.get_shifts(active_only=False)
        self.shift_table.setRowCount(len(shifts))
        for r, s in enumerate(shifts):
            self.shift_table.setItem(r, 0, QTableWidgetItem(s["label"]))
            self.shift_table.setItem(r, 1, QTableWidgetItem(s["start_time"]))
            self.shift_table.setItem(r, 2, QTableWidgetItem(s["end_time"]))
            roster_count = s["roster_count"] if "roster_count" in s.keys() else 0
            self.shift_table.setItem(r, 3, QTableWidgetItem(str(roster_count)))

            btn_w = QWidget()
            bh = QHBoxLayout(btn_w)
            bh.setContentsMargins(4, 2, 4, 2)
            bh.setSpacing(6)
            edit_btn = QPushButton("Edit")
            del_btn  = QPushButton("Delete")
            edit_btn.setStyleSheet(_BTN_PRIMARY)
            del_btn.setStyleSheet(_BTN_DANGER)
            edit_btn.setFixedHeight(26)
            del_btn.setFixedHeight(26)
            edit_btn.clicked.connect(lambda _, sid=s["id"]: self._edit_shift(sid))
            del_btn.clicked.connect(lambda _, sid=s["id"]: self._delete_shift(sid))
            bh.addWidget(edit_btn)
            bh.addWidget(del_btn)
            self.shift_table.setCellWidget(r, 4, btn_w)

    def _load_off_days(self):
        rows = self._db.get_off_days()
        self.offday_table.setRowCount(len(rows))
        for r, row in enumerate(rows):
            self.offday_table.setItem(r, 0, QTableWidgetItem(row["date"]))
            shift = self._db.get_shift(row["shift_id"]) if row["shift_id"] else None
            self.offday_table.setItem(r, 1, QTableWidgetItem(shift["label"] if shift else "All"))
            note = (row["note"] if "note" in row.keys() else "") or ""
            self.offday_table.setItem(r, 2, QTableWidgetItem(note))
            rm_btn = QPushButton("Remove")
            rm_btn.setStyleSheet(_BTN_DANGER)
            rm_btn.setFixedHeight(26)
            rm_btn.clicked.connect(lambda _, rid=row["id"]: self._remove_off_day(rid))
            self.offday_table.setCellWidget(r, 3, rm_btn)

    # ── Actions ───────────────────────────────────────────────────────────────
    def _add_shift(self):
        dlg = ShiftEditorDialog(self, db=self._db)
        if dlg.exec_() == QDialog.Accepted:
            self._load_shifts()

    def _edit_shift(self, shift_id):
        shift = self._db.get_shift(shift_id)
        if shift:
            dlg = ShiftEditorDialog(self, shift=dict(shift), db=self._db)
            if dlg.exec_() == QDialog.Accepted:
                self._load_shifts()

    def _delete_shift(self, shift_id):
        shift = self._db.get_shift(shift_id)
        if not shift:
            return
        reply = QMessageBox.question(
            self, "Delete Shift",
            f"Delete shift '{shift['label']}'?\n"
            "All roster assignments for this shift will also be removed.",
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No,
        )
        if reply == QMessageBox.Yes:
            self._db.delete_shift(shift_id)
            self._load_shifts()

    def _add_off_day(self):
        d        = self.offday_date.date().toString("yyyy-MM-dd")
        shift_id = self.offday_shift.currentData()
        note     = self.offday_note.text().strip()
        self._db.add_off_day(d, shift_id, note)
        self.offday_note.clear()
        self._load_off_days()

    def _remove_off_day(self, off_day_id):
        self._db.remove_off_day(off_day_id)
        self._load_off_days()
