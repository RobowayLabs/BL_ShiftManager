# ============================================================
#  ui/user_dialog.py  —  User management + system config (FR-8)
# ============================================================
from PyQt5.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QFormLayout, QGroupBox,
    QLabel, QLineEdit, QPushButton, QTableWidget, QTableWidgetItem,
    QComboBox, QMessageBox, QHeaderView, QTabWidget, QWidget,
    QScrollArea, QSizePolicy, QFrame
)
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QColor

_BTN_PRIMARY = ("background:#1f6feb; color:#fff; border-radius:4px;"
                " padding:3px 12px; border:none;")
_BTN_DANGER  = ("color:#f85149; border:1px solid #f85149; border-radius:4px;"
                " padding:3px 8px; background:transparent;")


class UserManagementDialog(QDialog):
    """Admin-only dialog for user accounts, system settings, and audit log."""

    def __init__(self, parent=None):
        super().__init__(parent)
        from database import get_db
        from auth import auth
        self._db   = get_db()
        self._auth = auth
        self.setWindowTitle("User Management & System Configuration")
        self.setMinimumSize(720, 560)
        self.resize(780, 620)
        self._build_ui()
        self._load_users()

    # ── Build UI ──────────────────────────────────────────────────────────────
    def _build_ui(self):
        layout = QVBoxLayout(self)
        layout.setSpacing(6)
        tabs = QTabWidget()
        tabs.currentChanged.connect(self._on_tab_changed)

        # Users tab ────────────────────────────────────────────────────────
        users_w = QWidget()
        ul = QVBoxLayout(users_w)
        ul.setContentsMargins(8, 8, 8, 8)
        ul.setSpacing(8)

        add_grp = QGroupBox("Add New User")
        add_form = QFormLayout(add_grp)
        add_form.setLabelAlignment(Qt.AlignRight)
        add_form.setSpacing(8)
        add_form.setContentsMargins(12, 10, 12, 10)

        self.new_username = QLineEdit()
        self.new_username.setPlaceholderText("Username")
        self.new_username.setMinimumHeight(28)
        self.new_password = QLineEdit()
        self.new_password.setEchoMode(QLineEdit.Password)
        self.new_password.setPlaceholderText("Password (min 6 characters)")
        self.new_password.setMinimumHeight(28)
        # Allow pressing Enter to submit
        self.new_password.returnPressed.connect(self._add_user)
        self.new_role = QComboBox()
        self.new_role.addItems(["viewer", "admin"])
        self.new_role.setMinimumHeight(28)

        add_btn = QPushButton("Add User")
        add_btn.setStyleSheet(_BTN_PRIMARY + " padding:4px 18px;")
        add_btn.clicked.connect(self._add_user)

        add_form.addRow("Username:", self.new_username)
        add_form.addRow("Password:", self.new_password)
        add_form.addRow("Role:",     self.new_role)
        add_form.addRow("",          add_btn)
        ul.addWidget(add_grp)

        self.user_table = QTableWidget(0, 5)
        self.user_table.setHorizontalHeaderLabels(
            ["Username", "Role", "Active", "Last Login", "Actions"]
        )
        hh = self.user_table.horizontalHeader()
        hh.setSectionResizeMode(0, QHeaderView.Stretch)
        hh.setSectionResizeMode(1, QHeaderView.ResizeToContents)
        hh.setSectionResizeMode(2, QHeaderView.ResizeToContents)
        hh.setSectionResizeMode(3, QHeaderView.ResizeToContents)
        hh.setSectionResizeMode(4, QHeaderView.Fixed)
        self.user_table.setColumnWidth(4, 220)
        self.user_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.user_table.setAlternatingRowColors(True)
        self.user_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.user_table.verticalHeader().setDefaultSectionSize(36)
        ul.addWidget(self.user_table)
        tabs.addTab(users_w, "Users")

        # System Config tab ────────────────────────────────────────────────
        # Wrap content in a scroll area so small windows don't clip settings
        cfg_scroll = QScrollArea()
        cfg_scroll.setWidgetResizable(True)
        cfg_scroll.setFrameShape(QFrame.NoFrame)

        cfg_inner = QWidget()
        cl = QVBoxLayout(cfg_inner)
        cl.setContentsMargins(10, 10, 10, 10)
        cl.setSpacing(10)

        self._cfg_inputs: dict = {}
        sections = {
            "Detection Thresholds": [
                ("face_recognition_interval",  "Face Recognition Interval (sec)", "30"),
                ("tiredness_alert_minutes",     "Tiredness Alert Threshold (min)",  "5"),
                ("sleep_alert_seconds",         "Sleep Alert Threshold (sec)",      "60"),
                ("phone_alert_seconds",         "Phone Usage Alert (sec)",          "30"),
                ("absence_alert_minutes",       "Absence Alert Threshold (min)",    "5"),
                ("crowding_threshold_persons",  "Crowding — Person Count",          "2"),
                ("crowding_alert_minutes",      "Crowding Alert Duration (min)",    "2"),
            ],
            "MQTT Settings": [
                ("mqtt_enabled",  "Enabled (true / false)",  "false"),
                ("mqtt_broker",   "Broker Host",             "localhost"),
                ("mqtt_port",     "Port",                    "1883"),
                ("mqtt_use_tls",  "Use TLS (true / false)",  "false"),
                ("mqtt_username", "Username (optional)",     ""),
                ("mqtt_password", "Password (optional)",     ""),
            ],
            "Redis Settings": [
                ("redis_enabled", "Enabled (true / false)",  "false"),
                ("redis_host",    "Host",                    "localhost"),
                ("redis_port",    "Port",                    "6379"),
                ("redis_password","Password (optional)",     ""),
            ],
            "General": [
                ("site_id",                "Site ID",               "banglalink"),
                ("session_timeout_minutes","Session Timeout (min)", "30"),
            ],
        }

        db_cfg = self._db.get_all_config()
        for section, keys in sections.items():
            grp = QGroupBox(section)
            gf  = QFormLayout(grp)
            gf.setLabelAlignment(Qt.AlignRight)
            gf.setSpacing(6)
            gf.setContentsMargins(12, 8, 12, 8)
            for key, label, default in keys:
                inp = QLineEdit(db_cfg.get(key, default))
                inp.setMinimumHeight(26)
                # Mask password fields
                if "password" in key.lower():
                    inp.setEchoMode(QLineEdit.Password)
                gf.addRow(label + ":", inp)
                self._cfg_inputs[key] = inp
            cl.addWidget(grp)

        save_cfg_btn = QPushButton("Save Configuration")
        save_cfg_btn.setStyleSheet(_BTN_PRIMARY + " padding:5px 20px; font-weight:bold;")
        save_cfg_btn.clicked.connect(self._save_config)
        cl.addWidget(save_cfg_btn, alignment=Qt.AlignRight)
        cl.addStretch()

        cfg_scroll.setWidget(cfg_inner)
        tabs.addTab(cfg_scroll, "System Config")

        # Audit Log tab ────────────────────────────────────────────────────
        audit_w = QWidget()
        al = QVBoxLayout(audit_w)
        al.setContentsMargins(8, 8, 8, 8)

        audit_ctrl = QHBoxLayout()
        refresh_btn = QPushButton("Refresh")
        refresh_btn.setStyleSheet(_BTN_PRIMARY)
        refresh_btn.clicked.connect(self._load_audit)
        audit_ctrl.addStretch()
        audit_ctrl.addWidget(refresh_btn)
        al.addLayout(audit_ctrl)

        self.audit_table = QTableWidget(0, 4)
        self.audit_table.setHorizontalHeaderLabels(["Time", "User", "Action", "Details"])
        ah = self.audit_table.horizontalHeader()
        ah.setSectionResizeMode(0, QHeaderView.ResizeToContents)
        ah.setSectionResizeMode(1, QHeaderView.ResizeToContents)
        ah.setSectionResizeMode(2, QHeaderView.ResizeToContents)
        ah.setSectionResizeMode(3, QHeaderView.Stretch)
        self.audit_table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.audit_table.setAlternatingRowColors(True)
        self.audit_table.verticalHeader().setDefaultSectionSize(28)
        al.addWidget(self.audit_table)
        tabs.addTab(audit_w, "Audit Log")

        layout.addWidget(tabs)

        close_btn = QPushButton("Close")
        close_btn.setMinimumWidth(90)
        close_btn.clicked.connect(self.accept)
        layout.addWidget(close_btn, alignment=Qt.AlignRight)

    # ── Slot: tab changed ─────────────────────────────────────────────────────
    def _on_tab_changed(self, idx: int):
        if idx == 2:
            self._load_audit()

    # ── Users ─────────────────────────────────────────────────────────────────
    def _load_users(self):
        users = self._db.get_all_users()
        self.user_table.setRowCount(len(users))
        for r, u in enumerate(users):
            self.user_table.setItem(r, 0, QTableWidgetItem(u["username"]))

            role_item = QTableWidgetItem(u["role"].upper())
            role_item.setForeground(
                QColor("#00d4ff") if u["role"] == "admin" else QColor("#8b949e")
            )
            self.user_table.setItem(r, 1, role_item)

            active_item = QTableWidgetItem("\u2714" if u["active"] else "\u2718")
            active_item.setForeground(
                QColor("#3fb950") if u["active"] else QColor("#f85149")
            )
            active_item.setTextAlignment(Qt.AlignCenter)
            self.user_table.setItem(r, 2, active_item)

            login = (u["last_login"] if "last_login" in u.keys() else None) or "Never"
            self.user_table.setItem(
                r, 3, QTableWidgetItem(login[:16] if len(login) > 16 else login)
            )

            btn_w = QWidget()
            bh = QHBoxLayout(btn_w)
            bh.setContentsMargins(4, 2, 4, 2)
            bh.setSpacing(5)
            pw_btn  = QPushButton("Reset PW")
            tog_btn = QPushButton("Disable" if u["active"] else "Enable")
            del_btn = QPushButton("Delete")
            for b in (pw_btn, tog_btn): b.setStyleSheet(_BTN_PRIMARY)
            del_btn.setStyleSheet(_BTN_DANGER)
            for b in (pw_btn, tog_btn, del_btn): b.setFixedHeight(26)

            uid, uname = u["id"], u["username"]
            pw_btn.clicked.connect(lambda _, i=uid: self._reset_password(i))
            tog_btn.clicked.connect(lambda _, i=uid, a=u["active"]: self._toggle_user(i, a))
            del_btn.clicked.connect(lambda _, i=uid, n=uname: self._delete_user(i, n))
            bh.addWidget(pw_btn)
            bh.addWidget(tog_btn)
            bh.addWidget(del_btn)
            self.user_table.setCellWidget(r, 4, btn_w)

    def _add_user(self):
        username = self.new_username.text().strip()
        password = self.new_password.text()
        role     = self.new_role.currentText()
        if not username or not password:
            QMessageBox.warning(self, "Error", "Username and password are required.")
            return
        if len(password) < 6:
            QMessageBox.warning(self, "Error", "Password must be at least 6 characters.")
            return
        try:
            self._db.add_user(username, password, role)
            self._db.audit(self._auth.current_username, "USER_ADDED",
                           f"username={username} role={role}")
            self.new_username.clear()
            self.new_password.clear()
            self._load_users()
            QMessageBox.information(self, "User Created",
                                    f"User '{username}' created successfully.")
        except Exception as e:
            QMessageBox.critical(self, "Error", f"Failed to add user:\n{e}")

    def _reset_password(self, user_id: int):
        u = self._db.get_user_by_id(user_id)
        if not u:
            return
        dlg = QDialog(self)
        dlg.setWindowTitle(f"Reset Password — {u['username']}")
        dlg.setMinimumWidth(340)
        dlg_layout = QVBoxLayout(dlg)
        dlg_layout.setSpacing(10)
        dlg_layout.addWidget(QLabel(f"New password for <b>{u['username']}</b>:"))
        pw_edit = QLineEdit()
        pw_edit.setEchoMode(QLineEdit.Password)
        pw_edit.setPlaceholderText("Min 6 characters")
        pw_edit.setMinimumHeight(28)
        pw_edit.returnPressed.connect(dlg.accept)
        dlg_layout.addWidget(pw_edit)
        btns = QHBoxLayout()
        ok_btn     = QPushButton("Set Password")
        cancel_btn = QPushButton("Cancel")
        ok_btn.setStyleSheet(_BTN_PRIMARY)
        ok_btn.clicked.connect(dlg.accept)
        cancel_btn.clicked.connect(dlg.reject)
        btns.addStretch()
        btns.addWidget(ok_btn)
        btns.addWidget(cancel_btn)
        dlg_layout.addLayout(btns)

        if dlg.exec_() == QDialog.Accepted:
            pw = pw_edit.text()
            if len(pw) < 6:
                QMessageBox.warning(self, "Error", "Password must be at least 6 characters.")
                return
            self._db.update_user_password(user_id, pw)
            self._db.audit(self._auth.current_username, "PASSWORD_RESET",
                           f"target_user={u['username']}")
            QMessageBox.information(self, "Done", "Password updated successfully.")

    def _toggle_user(self, user_id: int, currently_active: bool):
        self._db.set_user_active(user_id, not currently_active)
        u = self._db.get_user_by_id(user_id)
        action = "DISABLED" if currently_active else "ENABLED"
        self._db.audit(self._auth.current_username, f"USER_{action}",
                       f"target_user={u['username'] if u else user_id}")
        self._load_users()

    def _delete_user(self, user_id: int, username: str):
        if username == "admin":
            QMessageBox.warning(self, "Error",
                                "The default 'admin' account cannot be deleted.")
            return
        reply = QMessageBox.question(
            self, "Delete User",
            f"Permanently delete user '{username}'?\nThis cannot be undone.",
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No,
        )
        if reply == QMessageBox.Yes:
            self._db.delete_user(user_id)
            self._db.audit(self._auth.current_username, "USER_DELETED",
                           f"username={username}")
            self._load_users()

    # ── Config ────────────────────────────────────────────────────────────────
    def _save_config(self):
        for key, widget in self._cfg_inputs.items():
            self._db.set_config(key, widget.text().strip())
        self._db.audit(self._auth.current_username, "CONFIG_SAVED",
                       "system_config updated")
        try:
            from mqtt_service import reset_connections
            reset_connections()
        except Exception:
            pass
        QMessageBox.information(self, "Saved",
                                "Configuration saved.\nChanges take effect immediately.")

    # ── Audit log ─────────────────────────────────────────────────────────────
    def _load_audit(self):
        rows = self._db.get_audit_log(limit=300)
        self.audit_table.setRowCount(len(rows))
        for r, row in enumerate(rows):
            ts = (row["timestamp"] if "timestamp" in row.keys() else "") or ""
            self.audit_table.setItem(
                r, 0,
                QTableWidgetItem(ts[11:19] if len(ts) >= 19 else ts)
            )
            username = row["username"] if "username" in row.keys() else ""
            self.audit_table.setItem(r, 1, QTableWidgetItem(username))
            action = row["action"] if "action" in row.keys() else ""
            action_item = QTableWidgetItem(action)
            # Colour-code action types
            if "DELETE" in action:
                action_item.setForeground(QColor("#f85149"))
            elif "ADD" in action or "CREATE" in action:
                action_item.setForeground(QColor("#3fb950"))
            elif "CONFIG" in action:
                action_item.setForeground(QColor("#d29922"))
            self.audit_table.setItem(r, 2, action_item)
            details = (row["details"] if "details" in row.keys() else "") or ""
            self.audit_table.setItem(r, 3, QTableWidgetItem(details))
