# ============================================================
#  ui/styles.py  —  Professional dark theme stylesheet
# ============================================================

QSS = """
/* ── Global ─────────────────────────────────────────── */
QWidget {
    background-color: #0d1117;
    color: #c9d1d9;
    font-family: "Segoe UI", "SF Pro Display", system-ui, sans-serif;
    font-size: 13px;
}

QMainWindow, QDialog {
    background-color: #0d1117;
}

/* ── Group Boxes ─────────────────────────────────────── */
QGroupBox {
    border: 1px solid #21262d;
    border-radius: 4px;
    margin-top: 8px;
    padding: 6px 8px 8px 8px;
    font-size: 11px;
    font-weight: 600;
    color: #8b949e;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}
QGroupBox::title {
    subcontrol-origin: margin;
    subcontrol-position: top left;
    left: 8px;
    padding: 0 4px;
    color: #8b949e;
    font-size: 10px;
    letter-spacing: 1px;
    background-color: #0d1117;
}

/* ── Labels ──────────────────────────────────────────── */
QLabel {
    color: #8b949e;
    font-size: 13px;
}
QLabel#title {
    color: #e6edf3;
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 0.5px;
}
QLabel#subtitle {
    color: #6e7681;
    font-size: 11px;
    letter-spacing: 0.3px;
}
QLabel#status_ok    { color: #3fb950; font-weight: 600; }
QLabel#status_warn  { color: #d29922; font-weight: 600; }
QLabel#status_alert { color: #f85149; font-weight: 600; }
QLabel#metric_value {
    color: #58a6ff;
    font-size: 20px;
    font-weight: 600;
    font-family: "Consolas", "Courier New", monospace;
}
QLabel#metric_label {
    color: #6e7681;
    font-size: 10px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
}

/* ── Buttons ─────────────────────────────────────────── */
QPushButton {
    background-color: #21262d;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #c9d1d9;
    padding: 8px 16px;
    font-size: 12px;
    font-weight: 500;
    min-height: 20px;
}
QPushButton:hover {
    background-color: #30363d;
    border-color: #484f58;
    color: #ffffff;
}
QPushButton:pressed {
    background-color: #161b22;
    border-color: #21262d;
}
QPushButton:disabled {
    background-color: #161b22;
    border-color: #21262d;
    color: #484f58;
}
QPushButton#btn_start {
    background-color: #238636;
    border: 1px solid #2ea043;
    color: #ffffff;
}
QPushButton#btn_start:hover {
    background-color: #2ea043;
    border-color: #3fb950;
}
QPushButton#btn_start:disabled {
    background-color: #21262d;
    border-color: #30363d;
    color: #484f58;
}
QPushButton#btn_stop {
    background-color: #da3633;
    border: 1px solid #f85149;
    color: #ffffff;
}
QPushButton#btn_stop:hover {
    background-color: #b62324;
    border-color: #da3633;
}
QPushButton#btn_stop:disabled {
    background-color: #21262d;
    border-color: #30363d;
    color: #484f58;
}
QPushButton#btn_calib {
    background-color: #21262d;
    border: 1px solid #d29922;
    color: #e3b341;
}
QPushButton#btn_calib:hover {
    background-color: #3d2e00;
    border-color: #e3b341;
    color: #f0c848;
}

/* ── Tab Widget ──────────────────────────────────────── */
QTabWidget::pane {
    border: 1px solid #21262d;
    border-top: none;
    border-radius: 0 0 6px 6px;
    background-color: #0d1117;
    top: -1px;
}
QTabBar::tab {
    background-color: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 10px 18px;
    margin-right: 2px;
    min-width: 90px;
    color: #8b949e;
    font-size: 12px;
    font-weight: 500;
}
QTabBar::tab:selected {
    color: #58a6ff;
    border-bottom: 2px solid #58a6ff;
}
QTabBar::tab:hover:!selected {
    color: #c9d1d9;
}

/* ── Table ───────────────────────────────────────────── */
QTableWidget {
    background-color: #0d1117;
    alternate-background-color: #161b22;
    border: 1px solid #21262d;
    gridline-color: #21262d;
    color: #c9d1d9;
    font-size: 12px;
    selection-background-color: #388bfd26;
    selection-color: #58a6ff;
}
QTableWidget::item:selected {
    background-color: #388bfd26;
    color: #58a6ff;
}
QHeaderView::section {
    background-color: #161b22;
    color: #8b949e;
    border: none;
    border-bottom: 1px solid #21262d;
    padding: 8px 10px;
    font-size: 11px;
    font-weight: 600;
}

/* ── Scroll Bars ─────────────────────────────────────── */
QScrollBar:vertical {
    background: #0d1117;
    width: 10px;
    border: none;
    border-radius: 5px;
}
QScrollBar::handle:vertical {
    background: #30363d;
    border-radius: 5px;
    min-height: 24px;
}
QScrollBar::handle:vertical:hover { background: #484f58; }
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; }

/* ── ComboBox ────────────────────────────────────────── */
QComboBox {
    background-color: #21262d;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #c9d1d9;
    padding: 6px 12px;
    font-size: 12px;
    min-height: 20px;
}
QComboBox:hover {
    border-color: #484f58;
}
QComboBox::drop-down {
    border: none;
    width: 24px;
}
QComboBox QAbstractItemView {
    background-color: #161b22;
    border: 1px solid #21262d;
    color: #c9d1d9;
    selection-background-color: #388bfd26;
}

/* ── LineEdit ────────────────────────────────────────── */
QLineEdit {
    background-color: #0d1117;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #c9d1d9;
    padding: 6px 12px;
    font-size: 12px;
}
QLineEdit:focus {
    border-color: #58a6ff;
    outline: none;
}

/* ── Progress Bar ────────────────────────────────────── */
QProgressBar {
    background-color: #21262d;
    border: none;
    border-radius: 4px;
    text-align: center;
    color: #8b949e;
    font-size: 11px;
    height: 8px;
}
QProgressBar::chunk {
    background-color: #58a6ff;
    border-radius: 4px;
}

/* ── Text Edit (Log) ─────────────────────────────────── */
QTextEdit {
    background-color: #0d1117;
    border: 1px solid #21262d;
    color: #8b949e;
    font-family: "Consolas", "Courier New", monospace;
    font-size: 12px;
}

/* ── Splitter ────────────────────────────────────────── */
QSplitter::handle {
    background-color: #21262d;
}

/* ── Status Bar ──────────────────────────────────────── */
QStatusBar {
    background-color: #161b22;
    border-top: 1px solid #21262d;
    color: #8b949e;
    font-size: 11px;
}

/* ── Menu Bar ────────────────────────────────────────── */
QMenuBar {
    background-color: #0d1117;
    color: #c9d1d9;
}
QMenuBar::item:selected {
    background-color: #21262d;
    color: #ffffff;
}
QMenu {
    background-color: #161b22;
    border: 1px solid #21262d;
    color: #c9d1d9;
}
QMenu::item:selected {
    background-color: #388bfd26;
    color: #58a6ff;
}
"""

# Alert color map
ALERT_COLORS = {
    "critical": "#f85149",
    "warning":  "#d29922",
    "info":     "#58a6ff",
    "success":  "#3fb950",
}

EVENT_ICONS = {
    "sleep":   "💤",
    "drowsy":  "😴",
    "yawn":    "🥱",
    "phone":   "📱",
    "absence": "👻",
    "absent":  "👻",
    "SLEEP":   "💤",
    "DROWSY":  "⚠️",
    "YAWN":    "🥱",
    "PHONE":   "📱",
    "ABSENT":  "👻",
}
