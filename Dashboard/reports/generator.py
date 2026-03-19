# ============================================================
#  reports/generator.py  —  PDF & CSV report generation
# ============================================================
import os
import sys
import csv
from datetime import date, datetime, timedelta

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.gridspec import GridSpec
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import REPORT_DIR
from database import get_db

plt.rcParams.update({
    "figure.facecolor":  "#060c18",
    "axes.facecolor":    "#0a1528",
    "axes.edgecolor":    "#0e3d5a",
    "axes.labelcolor":   "#8ab8d0",
    "text.color":        "#8ab8d0",
    "xtick.color":       "#4a7a8a",
    "ytick.color":       "#4a7a8a",
    "grid.color":        "#0e2a40",
    "grid.alpha":        0.5,
    "font.family":       "monospace",
    "font.size":         9,
})


def _fmt_sec(s):
    m, sec = divmod(int(s), 60)
    h, m   = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{sec:02d}" if h else f"{m:02d}:{sec:02d}"


def generate_employee_report(employee_id: int, days: int = 30) -> str:
    """
    Generate a multi-page matplotlib figure saved as PNG.
    Returns file path.
    """
    db   = get_db()
    emp  = db.get_employee(employee_id)
    if not emp:
        return None

    rows = db.get_summary_range(employee_id, days)
    if not rows:
        return None

    dates   = [r["date"]         for r in rows]
    prod    = [r["productivity"]  for r in rows]
    sleep_h = [r["sleep_sec"] / 3600   for r in rows]
    phone_h = [r["phone_sec"] / 3600   for r in rows]
    abs_h   = [r["absence_sec"] / 3600 for r in rows]
    work_h  = [r["total_work_sec"] / 3600 for r in rows]

    # Short date labels
    short_dates = [d[5:] for d in dates]  # MM-DD

    fig = plt.figure(figsize=(12, 8))
    fig.patch.set_facecolor("#040810")
    gs  = GridSpec(3, 3, figure=fig, hspace=0.45, wspace=0.35)

    title = f"BANGLALINK EMS EMPLOYEE REPORT  ·  {emp['name'].upper()}  ·  Last {days} Days"
    fig.suptitle(title, fontsize=13, color="#00d4ff",
                 fontweight="bold", y=0.97)

    # ── 1. Productivity trend ─────────────────────────────────
    ax1 = fig.add_subplot(gs[0, :])
    ax1.fill_between(short_dates, prod, alpha=0.15, color="#00c8ff")
    ax1.plot(short_dates, prod, color="#00c8ff", linewidth=2, marker="o",
             markersize=4, label="Productivity %")
    ax1.axhline(80, color="#00ff88", linewidth=0.8, linestyle="--", alpha=0.6, label="Target 80%")
    ax1.axhline(60, color="#ffaa00", linewidth=0.8, linestyle="--", alpha=0.6, label="Warning 60%")
    ax1.set_ylim(0, 105)
    ax1.set_ylabel("PRODUCTIVITY %")
    ax1.set_title("PRODUCTIVITY TREND", color="#00c8ff", fontsize=10, loc="left")
    ax1.legend(loc="lower right", fontsize=8, facecolor="#0a1528",
               labelcolor="#8ab8d0", edgecolor="#0e3d5a")
    ax1.grid(True, axis="y")
    ax1.set_xticks(range(len(short_dates)))
    ax1.set_xticklabels(short_dates, rotation=45, ha="right", fontsize=7)
    # Color fill by zone
    for i, p in enumerate(prod):
        color = "#00ff8820" if p >= 80 else ("#ffaa0020" if p >= 60 else "#ff386020")
        ax1.axvspan(i-0.5, i+0.5, alpha=0.08,
                    color="#00ff88" if p >= 80 else ("#ffaa00" if p >= 60 else "#ff3860"))

    # ── 2. Daily behaviour stacked bar ────────────────────────
    ax2 = fig.add_subplot(gs[1, :2])
    x   = np.arange(len(dates))
    bw  = 0.6
    ax2.bar(x, sleep_h, bw, label="Sleep",   color="#ff3860", alpha=0.85)
    ax2.bar(x, phone_h, bw, bottom=sleep_h, label="Phone",   color="#cc44ff", alpha=0.85)
    ax2.bar(x, abs_h,   bw, bottom=[s+p for s,p in zip(sleep_h, phone_h)],
            label="Absent",  color="#ff8c00", alpha=0.85)
    ax2.set_ylabel("HOURS")
    ax2.set_title("DAILY DISTRACTION TIME", color="#00c8ff", fontsize=10, loc="left")
    ax2.set_xticks(x); ax2.set_xticklabels(short_dates, rotation=45, ha="right", fontsize=7)
    ax2.legend(fontsize=8, facecolor="#0a1528", labelcolor="#8ab8d0", edgecolor="#0e3d5a")
    ax2.grid(True, axis="y")

    # ── 3. Work hours ─────────────────────────────────────────
    ax3 = fig.add_subplot(gs[1, 2])
    wedge_data  = [sum(sleep_h), sum(phone_h), sum(abs_h),
                   max(0, sum(work_h) - sum(sleep_h) - sum(phone_h) - sum(abs_h))]
    wedge_labels = ["Sleep", "Phone", "Absent", "Active Work"]
    wedge_colors = ["#ff3860", "#cc44ff", "#ff8c00", "#00ff88"]
    non_zero = [(d,l,c) for d,l,c in zip(wedge_data, wedge_labels, wedge_colors) if d > 0]
    if non_zero:
        wd, wl, wc = zip(*non_zero)
        wedges, texts, autotexts = ax3.pie(
            wd, labels=wl, colors=wc, autopct="%1.0f%%",
            textprops={"fontsize": 8, "color": "#8ab8d0"},
            pctdistance=0.75, startangle=90,
            wedgeprops={"linewidth": 1, "edgecolor": "#040810"}
        )
        for at in autotexts:
            at.set_color("white"); at.set_fontsize(8)
    ax3.set_title(f"TIME ALLOCATION\n({days}d total)", color="#00c8ff", fontsize=9, loc="center")

    # ── 4. Sleep hours line ───────────────────────────────────
    ax4 = fig.add_subplot(gs[2, 0])
    ax4.fill_between(short_dates, [s*60 for s in sleep_h], alpha=0.2, color="#ff3860")
    ax4.plot(short_dates, [s*60 for s in sleep_h], color="#ff3860",
             linewidth=1.5, marker="o", markersize=3)
    ax4.set_ylabel("MINUTES")
    ax4.set_title("SLEEP TIME / DAY", color="#ff3860", fontsize=9, loc="left")
    ax4.set_xticks(range(len(short_dates)))
    ax4.set_xticklabels(short_dates, rotation=45, ha="right", fontsize=6)
    ax4.grid(True, axis="y")

    # ── 5. Phone usage line ───────────────────────────────────
    ax5 = fig.add_subplot(gs[2, 1])
    ax5.fill_between(short_dates, [p*60 for p in phone_h], alpha=0.2, color="#cc44ff")
    ax5.plot(short_dates, [p*60 for p in phone_h], color="#cc44ff",
             linewidth=1.5, marker="o", markersize=3)
    ax5.set_ylabel("MINUTES")
    ax5.set_title("PHONE USAGE / DAY", color="#cc44ff", fontsize=9, loc="left")
    ax5.set_xticks(range(len(short_dates)))
    ax5.set_xticklabels(short_dates, rotation=45, ha="right", fontsize=6)
    ax5.grid(True, axis="y")

    # ── 6. Summary stats ─────────────────────────────────────
    ax6 = fig.add_subplot(gs[2, 2])
    ax6.axis("off")
    avg_prod  = np.mean(prod)
    total_sleep = sum(r["sleep_sec"]   for r in rows)
    total_phone = sum(r["phone_sec"]   for r in rows)
    total_abs   = sum(r["absence_sec"] for r in rows)
    total_yawn  = sum(r["yawn_count"]  for r in rows)
    total_phone_cnt = sum(r["phone_count"] for r in rows)
    best_day  = dates[np.argmax(prod)] if dates else "-"
    worst_day = dates[np.argmin(prod)] if dates else "-"

    lines = [
        ("AVG PRODUCTIVITY", f"{avg_prod:.1f}%"),
        ("TOTAL SLEEP",      _fmt_sec(total_sleep)),
        ("TOTAL PHONE",      _fmt_sec(total_phone)),
        ("TOTAL ABSENT",     _fmt_sec(total_abs)),
        ("YAWN COUNT",       str(total_yawn)),
        ("PHONE EVENTS",     str(total_phone_cnt)),
        ("BEST DAY",         best_day[5:] if len(best_day) >= 5 else best_day),
        ("WORST DAY",        worst_day[5:] if len(worst_day) >= 5 else worst_day),
    ]
    y_pos = 0.92
    for label, val in lines:
        ax6.text(0.05, y_pos, label, transform=ax6.transAxes,
                 fontsize=8, color="#4a7a8a")
        ax6.text(0.65, y_pos, val, transform=ax6.transAxes,
                 fontsize=9, color="#00d4ff", fontweight="bold")
        y_pos -= 0.11
    ax6.set_title("SUMMARY STATS", color="#00c8ff", fontsize=9, loc="left")
    ax6.add_patch(mpatches.FancyBboxPatch((0,0), 1, 1, boxstyle="round,pad=0",
                  edgecolor="#0e3d5a", facecolor="none",
                  transform=ax6.transAxes, linewidth=1))

    fname = f"report_{emp['employee_id']}_{date.today().isoformat()}.png"
    fpath = os.path.join(REPORT_DIR, fname)
    fig.savefig(fpath, dpi=100, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    return fpath


def export_csv(employee_id: int, days: int = 30) -> str:
    db   = get_db()
    emp  = db.get_employee(employee_id)
    rows = db.get_summary_range(employee_id, days)
    if not rows or not emp:
        return None

    fname = f"export_{emp['employee_id']}_{date.today().isoformat()}.csv"
    fpath = os.path.join(REPORT_DIR, fname)

    with open(fpath, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Date", "Work(min)", "Sleep(min)", "Phone(min)",
                          "Absent(min)", "Yawns", "Phone Events", "Productivity(%)"])
        for r in rows:
            writer.writerow([
                r["date"],
                round(r["total_work_sec"]/60, 1),
                round(r["sleep_sec"]/60, 1),
                round(r["phone_sec"]/60, 1),
                round(r["absence_sec"]/60, 1),
                r["yawn_count"],
                r["phone_count"],
                round(r["productivity"], 1),
            ])
    return fpath


def generate_team_report(days: int = 7) -> str:
    """Team overview: all active employees for last N days."""
    db   = get_db()
    emps = db.get_employees(active_only=True)
    if not emps:
        return None

    fig, axes = plt.subplots(2, 2, figsize=(10, 6.5))
    fig.patch.set_facecolor("#040810")
    fig.suptitle(f"BANGLALINK EMS TEAM REPORT  ·  Last {days} Days",
                 fontsize=13, color="#00d4ff", fontweight="bold", y=0.97)

    names, prod_avg, sleep_avg, phone_avg = [], [], [], []
    for emp in emps:
        rows = db.get_summary_range(emp["id"], days)
        if rows:
            names.append(emp["name"].split()[0])
            prod_avg.append(np.mean([r["productivity"] for r in rows]))
            sleep_avg.append(np.mean([r["sleep_sec"]/60 for r in rows]))
            phone_avg.append(np.mean([r["phone_sec"]/60 for r in rows]))
        else:
            names.append(emp["name"].split()[0])
            prod_avg.append(100.0); sleep_avg.append(0); phone_avg.append(0)

    colors = ["#00ff88" if p >= 80 else ("#ffaa00" if p >= 60 else "#ff3860")
              for p in prod_avg]

    ax = axes[0, 0]
    bars = ax.barh(names, prod_avg, color=colors, height=0.6)
    ax.set_xlim(0, 100)
    ax.set_title("AVG PRODUCTIVITY %", color="#00c8ff", fontsize=10, loc="left")
    ax.axvline(80, color="#00ff88", linewidth=0.8, linestyle="--", alpha=0.6)
    ax.grid(True, axis="x")
    for bar, val in zip(bars, prod_avg):
        ax.text(bar.get_width()+1, bar.get_y()+bar.get_height()/2,
                f"{val:.0f}%", va="center", fontsize=8, color="#8ab8d0")

    ax = axes[0, 1]
    ax.bar(names, sleep_avg, color="#ff3860", alpha=0.85)
    ax.set_ylabel("MINUTES / DAY")
    ax.set_title("AVG SLEEP TIME", color="#ff3860", fontsize=10, loc="left")
    ax.grid(True, axis="y")

    ax = axes[1, 0]
    ax.bar(names, phone_avg, color="#cc44ff", alpha=0.85)
    ax.set_ylabel("MINUTES / DAY")
    ax.set_title("AVG PHONE USAGE", color="#cc44ff", fontsize=10, loc="left")
    ax.grid(True, axis="y")

    ax = axes[1, 1]
    ax.axis("off")
    today = date.today().isoformat()
    summary = db.get_all_employees_summary(today)
    table_data = [["NAME", "DEPT", "PROD%", "SLEEP", "PHONE"]]
    for r in summary:
        table_data.append([
            r["name"][:10],
            r["department"][:8] if r["department"] else "-",
            f"{r['productivity']:.0f}",
            f"{r['sleep']/60:.0f}m",
            f"{r['phone']/60:.0f}m",
        ])
    if len(table_data) > 1:
        tbl = ax.table(cellText=table_data[1:], colLabels=table_data[0],
                       loc="center", cellLoc="center")
        tbl.auto_set_font_size(False)
        tbl.set_fontsize(8)
        for (row, col), cell in tbl.get_celld().items():
            cell.set_facecolor("#0a1528" if row > 0 else "#040810")
            cell.set_edgecolor("#0e3d5a")
            cell.set_text_props(color="#8ab8d0" if row > 0 else "#00c8ff")
    ax.set_title("TODAY'S SNAPSHOT", color="#00c8ff", fontsize=10, loc="left")

    fname = f"team_report_{date.today().isoformat()}.png"
    fpath = os.path.join(REPORT_DIR, fname)
    fig.savefig(fpath, dpi=100, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    return fpath

# ============================================================
#  PDF Report (FR-10)  —  reportlab-based attendance summary
# ============================================================
def export_attendance_pdf(date_str: str = None) -> str:
    """Generate a one-page PDF attendance report for the given date.

    Returns the file path or None on error.
    """
    from datetime import date as _date
    if date_str is None:
        date_str = _date.today().isoformat()

    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib import colors
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
        )
    except ImportError:
        return None

    db   = get_db()
    rows = db.get_attendance_for_date(date_str)

    fname = f"attendance_{date_str}.pdf"
    fpath = os.path.join(REPORT_DIR, fname)

    doc = SimpleDocTemplate(fpath, pagesize=A4,
                            leftMargin=2*cm, rightMargin=2*cm,
                            topMargin=2*cm,  bottomMargin=2*cm)
    story = []
    styles = getSampleStyleSheet()

    # Title
    title_style = ParagraphStyle("title", parent=styles["Title"],
                                 textColor=colors.HexColor("#00d4ff"),
                                 fontSize=16, spaceAfter=4)
    sub_style   = ParagraphStyle("sub", parent=styles["Normal"],
                                 textColor=colors.HexColor("#5a8a9a"),
                                 fontSize=9, spaceAfter=12)
    body_style  = ParagraphStyle("body", parent=styles["Normal"],
                                 textColor=colors.HexColor("#c9d1d9"),
                                 fontSize=10)

    story.append(Paragraph("BANGLALINK EMS — ATTENDANCE REPORT", title_style))
    story.append(Paragraph(f"Date: {date_str}  ·  Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
                           sub_style))
    story.append(HRFlowable(width="100%", color=colors.HexColor("#0e3d5a")))
    story.append(Spacer(1, 12))

    # KPI row
    total_emps = len(db.get_employees(active_only=True))
    present    = len({r["employee_id"] for r in rows})
    kpi_data   = [
        ["Total Employees", "Present Today", "Absent Today", "Attendance Rate"],
        [str(total_emps), str(present),
         str(total_emps - present),
         f"{present / total_emps * 100:.0f}%" if total_emps else "—"],
    ]
    kpi_table = Table(kpi_data, colWidths=[4*cm]*4)
    kpi_table.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, 0),  colors.HexColor("#040810")),
        ("TEXTCOLOR",    (0, 0), (-1, 0),  colors.HexColor("#00d4ff")),
        ("BACKGROUND",   (0, 1), (-1, -1), colors.HexColor("#0a1528")),
        ("TEXTCOLOR",    (0, 1), (-1, -1), colors.HexColor("#c9d1d9")),
        ("FONTSIZE",     (0, 0), (-1, -1), 10),
        ("ALIGN",        (0, 0), (-1, -1), "CENTER"),
        ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
        ("ROWBACKGROUNDS",(0, 0),(-1, -1), [colors.HexColor("#040810"),
                                             colors.HexColor("#0a1528")]),
        ("GRID",         (0, 0), (-1, -1), 0.5, colors.HexColor("#0e3d5a")),
        ("TOPPADDING",   (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 8),
    ]))
    story.append(kpi_table)
    story.append(Spacer(1, 16))

    # Attendance table
    story.append(Paragraph("Attendance Records", ParagraphStyle(
        "h2", parent=styles["Heading2"],
        textColor=colors.HexColor("#00d4ff"), fontSize=12, spaceAfter=6)))

    if rows:
        header = ["Name", "Emp ID", "Department", "Event", "Status", "Time", "Camera"]
        table_data = [header]
        for r in rows:
            t = r.get("recognized_at", "")
            table_data.append([
                r.get("name", ""),
                r.get("emp_code", ""),
                r.get("department", "") or "—",
                r.get("event_type", "").upper(),
                (r.get("status", "") or "").replace("_", " ").title(),
                t[11:19] if len(t) >= 19 else t,
                f"Cam {r.get('camera_id', 0) + 1}",
            ])
        col_widths = [4*cm, 2.5*cm, 3*cm, 1.8*cm, 2.5*cm, 2*cm, 1.8*cm]
        att_table = Table(table_data, colWidths=col_widths)
        att_table.setStyle(TableStyle([
            ("BACKGROUND",   (0, 0), (-1, 0),  colors.HexColor("#040810")),
            ("TEXTCOLOR",    (0, 0), (-1, 0),  colors.HexColor("#00d4ff")),
            ("FONTSIZE",     (0, 0), (-1, -1), 8),
            ("ALIGN",        (0, 0), (-1, -1), "CENTER"),
            ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
            ("ROWBACKGROUNDS",(0, 1),(-1, -1), [colors.HexColor("#0a1528"),
                                                 colors.HexColor("#060c18")]),
            ("TEXTCOLOR",    (0, 1), (-1, -1), colors.HexColor("#8ab8d0")),
            ("GRID",         (0, 0), (-1, -1), 0.3, colors.HexColor("#0e3d5a")),
            ("TOPPADDING",   (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING",(0, 0), (-1, -1), 5),
        ]))
        story.append(att_table)
    else:
        story.append(Paragraph("No attendance records found for this date.", body_style))

    story.append(Spacer(1, 20))
    story.append(Paragraph(
        f"Report generated by BANGLALINK EMS  ·  Banglalink Digital Communications Ltd.",
        ParagraphStyle("footer", parent=styles["Normal"],
                       textColor=colors.HexColor("#2a4a5a"), fontSize=8)
    ))

    doc.build(story)
    return fpath


def export_shift_summary_pdf(date_str: str = None) -> str:
    """PDF report: per-shift attendance summary."""
    from datetime import date as _date
    if date_str is None:
        date_str = _date.today().isoformat()
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib import colors
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
        )
    except ImportError:
        return None

    from shifts import get_shift_summary_for_date
    summaries = get_shift_summary_for_date(date_str)

    fname = f"shift_summary_{date_str}.pdf"
    fpath = os.path.join(REPORT_DIR, fname)
    doc   = SimpleDocTemplate(fpath, pagesize=A4,
                              leftMargin=2*cm, rightMargin=2*cm,
                              topMargin=2*cm, bottomMargin=2*cm)
    story = []
    styles = getSampleStyleSheet()
    title_s = ParagraphStyle("t", parent=styles["Title"],
                              textColor=colors.HexColor("#00d4ff"), fontSize=16)
    story.append(Paragraph("BANGLALINK EMS — SHIFT SUMMARY REPORT", title_s))
    story.append(Paragraph(f"Date: {date_str}", ParagraphStyle(
        "sub", parent=styles["Normal"], textColor=colors.HexColor("#5a8a9a"), fontSize=9)))
    story.append(HRFlowable(width="100%", color=colors.HexColor("#0e3d5a")))
    story.append(Spacer(1, 12))

    header = ["Shift", "Roster Size", "Present", "Absent", "Completion %"]
    data   = [header]
    for s in summaries:
        data.append([
            s["shift_label"], str(s["total"]),
            str(s["present"]), str(s["absent"]),
            f"{s['completion']:.1f}%",
        ])
    tbl = Table(data, colWidths=[4*cm, 3*cm, 3*cm, 3*cm, 3*cm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0),  colors.HexColor("#040810")),
        ("TEXTCOLOR",     (0, 0), (-1, 0),  colors.HexColor("#00d4ff")),
        ("FONTSIZE",      (0, 0), (-1, -1), 10),
        ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
        ("ROWBACKGROUNDS",(0, 1),(-1, -1),  [colors.HexColor("#0a1528"),
                                              colors.HexColor("#060c18")]),
        ("TEXTCOLOR",     (0, 1), (-1, -1), colors.HexColor("#8ab8d0")),
        ("GRID",          (0, 0), (-1, -1), 0.5, colors.HexColor("#0e3d5a")),
        ("TOPPADDING",    (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(tbl)
    doc.build(story)
    return fpath
