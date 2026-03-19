#!/usr/bin/env python3
# ============================================================
#  main.py  —  Entry point for ROBOWAY SENTINEL EMS
# ============================================================
import sys
import os
import warnings
import logging
import logging.handlers

# Silence TF / oneDNN noise before heavy imports
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")
warnings.filterwarnings("ignore", message=".*deprecated.*", category=UserWarning)
warnings.filterwarnings("ignore", message=".*tf\\.losses\\..*")
warnings.filterwarnings("ignore", message=".*[Tt]hread mode.*", category=UserWarning)
# Matplotlib: categorical units / string labels parsed as numbers
warnings.filterwarnings("ignore", message=".*categorical units.*", category=UserWarning)

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Pre-load torch (avoid WinError 1114 on Windows)
try:
    import torch  # noqa: F401
except Exception:
    pass

from PyQt5.QtWidgets import QApplication, QLabel, QMessageBox, QWidget, QVBoxLayout, QFrame
from PyQt5.QtCore    import Qt, QTimer
from PyQt5.QtGui     import QFont, QPixmap

from config import APP_NAME, APP_VERSION, COMPANY, BASE_DIR, LOGO_PATH


# ── Rotating logger ───────────────────────────────────────────
def _setup_logging():
    log_dir  = os.path.join(BASE_DIR, "logs")
    os.makedirs(log_dir, exist_ok=True)
    handler  = logging.handlers.RotatingFileHandler(
        os.path.join(log_dir, "sentinel.log"),
        maxBytes=100 * 1024 * 1024,   # 100 MB
        backupCount=5,
        encoding="utf-8",
    )
    handler.setFormatter(logging.Formatter(
        "%(asctime)s  %(levelname)-8s  %(name)s  %(message)s"
    ))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)
    root.addHandler(logging.StreamHandler(sys.stdout))


def _create_splash(app) -> QWidget:
    container = QWidget()
    container.setFixedSize(520, 340)
    container.setAttribute(Qt.WA_TranslucentBackground)
    container.setWindowFlags(Qt.SplashScreen | Qt.FramelessWindowHint)
    container.setStyleSheet("QWidget { background: transparent; }")

    # Inner card: only visible part, no edge
    card = QFrame()
    card.setStyleSheet("""
        QFrame {
            background-color: #040810;
            border: none;
            border-radius: 12px;
        }
        QLabel {
            background-color: transparent;
            border: none;
            color: #00d4ff;
            font-family: 'Courier New', monospace;
        }
    """)
    layout = QVBoxLayout(container)
    layout.setContentsMargins(0, 0, 0, 0)
    layout.addWidget(card)
    card_layout = QVBoxLayout(card)
    card_layout.setContentsMargins(20, 20, 20, 20)
    card_layout.setSpacing(12)
    card_layout.setAlignment(Qt.AlignCenter)
    if os.path.isfile(LOGO_PATH):
        logo_lbl = QLabel()
        logo_lbl.setAlignment(Qt.AlignCenter)
        pm = QPixmap(LOGO_PATH)
        if not pm.isNull():
            pm = pm.scaled(120, 120, Qt.KeepAspectRatio, Qt.SmoothTransformation)
            logo_lbl.setPixmap(pm)
        card_layout.addWidget(logo_lbl)
    lbl = QLabel()
    lbl.setAlignment(Qt.AlignCenter)
    lbl.setText(
        f"<div style='text-align:center;'>"
        f"<p style='font-size:26px; font-weight:bold; color:#00d4ff; "
        f"letter-spacing:5px;'>{APP_NAME}</p>"
        f"<p style='font-size:11px; color:#4a7a8a; letter-spacing:3px;'>"
        f"INTELLIGENT EMPLOYEE MONITORING SYSTEM</p>"
        f"<p style='font-size:10px; color:#2a5a6a;'>{COMPANY}</p>"
        f"<p style='font-size:11px; color:#0e3d5a; margin-top:30px;'>"
        f"v{APP_VERSION}  ·  Initializing…</p>"
        f"</div>"
    )
    card_layout.addWidget(lbl)
    container.show()
    return container


def main():
    _setup_logging()
    logger = logging.getLogger(__name__)
    logger.info("=" * 60)
    logger.info("ROBOWAY SENTINEL EMS  v%s  starting", APP_VERSION)

    QApplication.setAttribute(Qt.AA_EnableHighDpiScaling)
    QApplication.setAttribute(Qt.AA_UseHighDpiPixmaps)
    app = QApplication(sys.argv)
    app.setApplicationName(APP_NAME)
    app.setOrganizationName(COMPANY)

    # Splash
    splash = _create_splash(app)
    app.processEvents()

    # Database init
    try:
        from database import get_db
        db = get_db()
        logger.info("[DB] Initialized at %s", db._path)
    except Exception as e:
        logger.exception("[DB] Init failed: %s", e)
        QMessageBox.critical(None, "Database Error",
                             f"Failed to initialise database:\n{e}")
        sys.exit(1)

    # Login dialog (FR-8)
    from ui.login_dialog import LoginDialog
    splash.close()
    login_dlg = LoginDialog()
    if login_dlg.exec_() != LoginDialog.Accepted or not login_dlg.auth_session:
        logger.info("Login cancelled — exiting.")
        sys.exit(0)

    session = login_dlg.auth_session
    logger.info("[AUTH] Logged in as %s (%s)", session.username, session.role)

    # Main window
    from main_window import MainWindow
    window = MainWindow(auth_session=session)
    window.showMaximized()

    # MQTT retry timer (every 60 s) — publishes any un-published alerts
    def _mqtt_retry():
        try:
            from mqtt_service import retry_unpublished
            retry_unpublished()
        except Exception:
            pass

    mqtt_timer = QTimer()
    mqtt_timer.timeout.connect(_mqtt_retry)
    mqtt_timer.start(60_000)

    # Session timeout watchdog (every 30 s)
    def _check_session():
        from auth import auth
        if not auth.require_any():
            logger.info("[AUTH] Session timed out — returning to login.")
            window.hide()
            login2 = LoginDialog()
            if login2.exec_() == LoginDialog.Accepted and login2.auth_session:
                window.set_session(login2.auth_session)
                window.showMaximized()
            else:
                window.close()
                app.quit()

    session_timer = QTimer()
    session_timer.timeout.connect(_check_session)
    session_timer.start(30_000)

    # Touch session on any mouse/key event
    app.installEventFilter(window)

    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
