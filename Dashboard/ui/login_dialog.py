# ============================================================
#  ui/login_dialog.py  —  Login dialog (FR-8)
#  bcrypt-hashed passwords, role-based result
# ============================================================
import os
from PyQt5.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit,
    QPushButton, QMessageBox, QFrame
)
from PyQt5.QtCore import Qt, QTimer
from PyQt5.QtGui import QFont, QPixmap, QIcon

from config import APP_NAME, APP_VERSION, COMPANY, LOGO_PATH, ICONS_DIR

_STYLE = """
QDialog {
    background-color: #040810;
}
QLabel#title {
    font-size: 20px;
    font-weight: bold;
    color: #00d4ff;
    letter-spacing: 4px;
}
QLabel#subtitle {
    font-size: 10px;
    color: #2a6a8a;
    letter-spacing: 3px;
}
QLabel {
    color: #5a8a9a;
    font-size: 12px;
}
QLineEdit {
    background: #0a1528;
    border: 1px solid #0e3d5a;
    border-radius: 4px;
    color: #c9d1d9;
    padding: 8px 10px;
    font-size: 13px;
    selection-background-color: #0e3d5a;
}
QLineEdit:focus {
    border-color: #00d4ff;
}
QPushButton#btn_login {
    background: #0e3d5a;
    border: 1px solid #00d4ff;
    border-radius: 4px;
    color: #00d4ff;
    font-size: 13px;
    font-weight: bold;
    padding: 10px 0;
    letter-spacing: 2px;
}
QPushButton#btn_login:hover {
    background: #1a5a7a;
}
QPushButton#btn_login:pressed {
    background: #0a2a40;
}
QLabel#err {
    color: #f85149;
    font-size: 11px;
}
QFrame#card {
    background: #0a0e18;
    border: 1px solid #0e3d5a;
    border-radius: 8px;
}
"""


class LoginDialog(QDialog):
    """Modal login dialog. After acceptance, `auth_session` holds the Session object."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.auth_session = None
        self.setWindowTitle(f"{APP_NAME} — Login")
        self.setFixedSize(400, 420)
        self.setWindowFlags(Qt.Dialog | Qt.FramelessWindowHint)
        self.setStyleSheet(_STYLE)
        self._set_window_icon()
        self._build_ui()

    def _set_window_icon(self):
        """Set window icon from assets/icons (app.ico or app.png)."""
        for name in ("app.ico", "app.png"):
            path = os.path.join(ICONS_DIR, name)
            if os.path.isfile(path):
                self.setWindowIcon(QIcon(path))
                break

    def _build_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(30, 30, 30, 30)
        root.setSpacing(0)

        # Card frame
        card = QFrame()
        card.setObjectName("card")
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(28, 28, 28, 28)
        card_layout.setSpacing(14)

        # Logo from assets (optional)
        if os.path.isfile(LOGO_PATH):
            logo_lbl = QLabel()
            logo_lbl.setAlignment(Qt.AlignCenter)
            pm = QPixmap(LOGO_PATH)
            if not pm.isNull():
                pm = pm.scaled(80, 80, Qt.KeepAspectRatio, Qt.SmoothTransformation)
                logo_lbl.setPixmap(pm)
            card_layout.addWidget(logo_lbl)
            card_layout.addSpacing(8)

        # Header
        title = QLabel(APP_NAME)
        title.setObjectName("title")
        title.setAlignment(Qt.AlignCenter)
        sub = QLabel("INTELLIGENT EMPLOYEE MONITORING SYSTEM")
        sub.setObjectName("subtitle")
        sub.setAlignment(Qt.AlignCenter)
        sub.setWordWrap(True)
        ver = QLabel(f"{COMPANY}  ·  v{APP_VERSION}")
        ver.setObjectName("subtitle")
        ver.setAlignment(Qt.AlignCenter)
        ver.setStyleSheet("color: #1a4a6a; font-size: 9px; letter-spacing: 2px;")

        card_layout.addWidget(title)
        card_layout.addWidget(sub)
        card_layout.addWidget(ver)
        card_layout.addSpacing(16)

        # Divider
        div = QFrame()
        div.setFrameShape(QFrame.HLine)
        div.setStyleSheet("color: #0e3d5a;")
        card_layout.addWidget(div)
        card_layout.addSpacing(10)

        # Username
        card_layout.addWidget(QLabel("USERNAME"))
        self.username_edit = QLineEdit()
        self.username_edit.setPlaceholderText("Enter username")
        self.username_edit.returnPressed.connect(self._do_login)
        card_layout.addWidget(self.username_edit)

        # Password
        card_layout.addWidget(QLabel("PASSWORD"))
        self.password_edit = QLineEdit()
        self.password_edit.setEchoMode(QLineEdit.Password)
        self.password_edit.setPlaceholderText("Enter password")
        self.password_edit.returnPressed.connect(self._do_login)
        card_layout.addWidget(self.password_edit)

        # Error label
        self.err_lbl = QLabel("")
        self.err_lbl.setObjectName("err")
        self.err_lbl.setAlignment(Qt.AlignCenter)
        card_layout.addWidget(self.err_lbl)

        card_layout.addSpacing(6)

        # Login button
        self.login_btn = QPushButton("LOGIN")
        self.login_btn.setObjectName("btn_login")
        self.login_btn.clicked.connect(self._do_login)
        card_layout.addWidget(self.login_btn)

        root.addWidget(card)

        # Default hint
        hint = QLabel("Default credentials: admin / admin123")
        hint.setAlignment(Qt.AlignCenter)
        hint.setStyleSheet("color: #1a3a4a; font-size: 10px; margin-top: 10px;")
        root.addWidget(hint)

        self.username_edit.setFocus()

    def _do_login(self):
        username = self.username_edit.text().strip()
        password = self.password_edit.text()
        if not username or not password:
            self.err_lbl.setText("Username and password required.")
            return
        self.login_btn.setEnabled(False)
        self.err_lbl.setText("Authenticating…")
        self.repaint()

        from auth import auth
        session = auth.login(username, password)
        if session:
            self.auth_session = session
            self.accept()
        else:
            self.err_lbl.setText("Invalid credentials. Please try again.")
            self.password_edit.clear()
            self.password_edit.setFocus()
        self.login_btn.setEnabled(True)

    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Escape:
            pass   # Prevent closing via Escape on login screen
        else:
            super().keyPressEvent(event)
