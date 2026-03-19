# ============================================================
#  ui/kpi_widget.py  —  Live KPI Dashboard (FR-10)
#  Shows: present count, shift completion, top alert category,
#  active camera count, and per-alert-type totals.
#  Refreshes every 10 seconds via QTimer.
# ============================================================
from PyQt5.QtWidgets import (
    QWidget, QHBoxLayout, QVBoxLayout, QLabel, QFrame
)
from PyQt5.QtCore import Qt, QTimer
from PyQt5.QtGui import QFont


def _make_card(title: str, value_lbl: QLabel, accent: str = "#00d4ff") -> QFrame:
    """Return a styled KPI card containing a value label."""
    card = QFrame()
    card.setFrameShape(QFrame.StyledPanel)
    card.setSizePolicy(
        card.sizePolicy().horizontalPolicy(),
        card.sizePolicy().verticalPolicy()
    )
    card.setStyleSheet(f"""
        QFrame {{
            background: #0a1528;
            border: 1px solid {accent}33;
            border-left: 3px solid {accent};
            border-radius: 6px;
            min-width: 90px;
        }}
    """)
    v = QVBoxLayout(card)
    v.setContentsMargins(10, 6, 10, 6)
    v.setSpacing(2)

    title_lbl = QLabel(title)
    title_lbl.setStyleSheet(
        "color:#4a7a8a; font-size:9px; letter-spacing:1px;"
        " background:transparent; border:none;"
    )
    title_lbl.setWordWrap(False)

    value_lbl.setStyleSheet(
        f"color:{accent}; font-size:18px; font-weight:bold;"
        " background:transparent; border:none;"
    )
    value_lbl.setAlignment(Qt.AlignLeft | Qt.AlignVCenter)

    v.addWidget(title_lbl)
    v.addWidget(value_lbl)
    return card


class KPIWidget(QWidget):
    """Compact live KPI bar displayed at the top of the Monitor tab."""

    # Accent colours per card
    _ACCENTS = {
        "present":    "#3fb950",
        "total":      "#00d4ff",
        "shift":      "#00d4ff",
        "completion": "#d29922",
        "cameras":    "#3fb950",
        "top_alert":  "#f85149",
        "alerts":     "#a371f7",
    }

    def __init__(self, parent=None):
        super().__init__(parent)
        # Allow vertical shrink — let the parent decide height
        self.setMinimumHeight(68)
        self.setMaximumHeight(90)
        self._camera_count = 0
        self._build_ui()
        self._timer = QTimer(self)
        self._timer.timeout.connect(self.refresh)
        self._timer.start(10_000)
        self.refresh()

    def _build_ui(self):
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        row = QHBoxLayout()
        row.setContentsMargins(4, 4, 4, 4)
        row.setSpacing(6)

        self._lbl = {}
        cards = [
            ("present",    "PRESENT",          "#3fb950"),
            ("total",      "TOTAL EMPLOYEES",  "#00d4ff"),
            ("shift",      "ACTIVE SHIFT",     "#00d4ff"),
            ("completion", "SHIFT COMPLETION", "#d29922"),
            ("cameras",    "ACTIVE CAMERAS",   "#3fb950"),
            ("top_alert",  "TOP ALERT TODAY",  "#f85149"),
            ("alerts",     "ALERTS TODAY",     "#a371f7"),
        ]
        for key, title, accent in cards:
            lbl = QLabel("—")
            self._lbl[key] = lbl
            row.addWidget(_make_card(title, lbl, accent), 1)

        outer.addLayout(row)

        # Thin separator line
        line = QFrame()
        line.setFrameShape(QFrame.HLine)
        line.setStyleSheet("background:#1a2332; max-height:1px; border:none;")
        outer.addWidget(line)

    # ── Public API ────────────────────────────────────────────────────────────
    def set_camera_count(self, count: int):
        """Called from MainWindow when workers start/stop."""
        self._camera_count = count
        self._lbl["cameras"].setText(str(count))

    # ── Refresh ───────────────────────────────────────────────────────────────
    def refresh(self):
        """Query DB and update all KPI labels.  Errors are silently swallowed
        so a DB hiccup never crashes the UI thread."""
        try:
            from database import get_db
            from shifts import get_active_shift, get_shift_summary_for_date
            from datetime import date

            db      = get_db()
            present = db.get_present_count_today()
            total   = len(db.get_employees(active_only=True))

            self._lbl["present"].setText(str(present))
            self._lbl["total"].setText(str(total))

            # Colour present label red when nobody is in
            self._lbl["present"].setStyleSheet(
                f"color:{'#3fb950' if present > 0 else '#f85149'};"
                " font-size:18px; font-weight:bold;"
                " background:transparent; border:none;"
            )

            shift = get_active_shift()
            self._lbl["shift"].setText(shift["label"] if shift else "—")

            today     = date.today().isoformat()
            summaries = get_shift_summary_for_date(today)
            if summaries and shift:
                s = next(
                    (x for x in summaries if x["shift_id"] == shift["id"]), None
                )
                if s and s.get("total"):
                    pct = s["completion"]
                    self._lbl["completion"].setText(f"{pct:.0f}%")
                    # Colour: green ≥80 %, amber 50–79 %, red <50 %
                    c = "#3fb950" if pct >= 80 else ("#d29922" if pct >= 50 else "#f85149")
                    self._lbl["completion"].setStyleSheet(
                        f"color:{c}; font-size:18px; font-weight:bold;"
                        " background:transparent; border:none;"
                    )
                else:
                    self._lbl["completion"].setText("—")
            else:
                self._lbl["completion"].setText("—")

            top    = db.get_top_alert_today()
            counts = db.get_alert_type_counts_today()
            self._lbl["top_alert"].setText(top.upper() if top != "—" else "—")
            self._lbl["alerts"].setText(str(sum(counts.values())))

        except Exception:
            pass   # never crash the GUI thread
