import { useState, useMemo, useEffect, type FC } from "react";
import {
  format, addDays, parseISO, eachDayOfInterval,
  differenceInCalendarDays, isAfter,
} from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "../lib/utils";
import {
  FileText, Download, FileSpreadsheet, Loader2,
  Calendar, Search, Sun, Sunset, Moon, Users,
  AlertTriangle, Clock, ArrowLeft, ChevronRight,
  TrendingUp, TrendingDown, Minus, Activity,
  Eye, PhoneCall, BedDouble, UserX, BarChart3,
  Star, ThumbsUp, ThumbsDown,
} from "lucide-react";
import { Button } from "../components/Button";
import { useShifts } from "../hooks/useShifts";
import { useEmployees } from "../hooks/useEmployees";
import { exportDailyReport, exportAllReports } from "../lib/exportExcel";
import { Shift, Employee } from "../types";
import { getFullReport, type FullReportRow } from "../api/reports";

const MAX_RANGE_DAYS = 60;

// ─── Shift meta ─────────────────────────────────────────────────────────────
const SHIFT_META = {
  Morning:   { label: "Morning",   time: "08:00 – 16:00", scheduledStart: "08:00", scheduledEnd: "16:00", icon: Sun,    color: "text-brand-accent",  bg: "bg-brand-accent/10",  border: "border-brand-accent/30"  },
  Afternoon: { label: "Afternoon", time: "16:00 – 00:00", scheduledStart: "16:00", scheduledEnd: "00:00", icon: Sunset, color: "text-brand-warning", bg: "bg-brand-warning/10", border: "border-brand-warning/30" },
  Night:     { label: "Night",     time: "00:00 – 08:00", scheduledStart: "00:00", scheduledEnd: "08:00", icon: Moon,   color: "text-brand-danger",  bg: "bg-brand-danger/10",  border: "border-brand-danger/30"  },
} as const;

type ShiftType = keyof typeof SHIFT_META;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function timeToSec(t: string): number {
  const [h, m, s] = t.split(":").map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

function calcWorkSeconds(start?: string, end?: string): number {
  if (!start || !end || start === "--:--:--" || end === "--:--:--") return 0;
  const s = timeToSec(start);
  const e = timeToSec(end);
  const diff = e >= s ? e - s : e + 86400 - s;
  return diff;
}

function formatDuration(sec: number): string {
  if (sec === 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function totalAlerts(shift: Shift): number {
  const a = shift.aiMetadata?.alerts;
  return a ? a.drowsy + a.sleep + a.phone + a.absence : 0;
}

/** Efficiency score 0–100: penalise alerts, reward time worked vs 8h shift */
function calcEfficiency(shift: Shift): number {
  const workSec = calcWorkSeconds(shift.aiMetadata?.actualStart, shift.aiMetadata?.actualEnd);
  const alerts  = totalAlerts(shift);
  const shiftDurationSec = 8 * 3600;

  const timeScore  = Math.min(100, (workSec / shiftDurationSec) * 100); // 0–100
  const alertPenalty = Math.min(100, alerts * 8);                        // 8 pts per alert
  return Math.max(0, Math.round(timeScore - alertPenalty));
}

function efficiencyLabel(score: number): { label: string; color: string; bg: string } {
  if (score >= 80) return { label: "Excellent",  color: "text-brand-success",  bg: "bg-brand-success/20"  };
  if (score >= 60) return { label: "Good",       color: "text-brand-accent",   bg: "bg-brand-accent/20"   };
  if (score >= 40) return { label: "Average",    color: "text-brand-warning",  bg: "bg-brand-warning/20"  };
  if (score >= 20) return { label: "Below Avg",  color: "text-orange-400",     bg: "bg-orange-400/20"     };
  return               { label: "Poor",        color: "text-brand-danger",   bg: "bg-brand-danger/20"   };
}

// ─── Shift Summary Card ───────────────────────────────────────────────────────
const ShiftSummaryCard: FC<{ type: ShiftType; shifts: Shift[]; onClick: () => void }> = ({
  type, shifts, onClick,
}) => {
  const meta    = SHIFT_META[type];
  const Icon    = meta.icon;
  const count   = shifts.length;
  const alerts  = shifts.reduce((a, s) => a + totalAlerts(s), 0);
  const isEmpty = count === 0;

  return (
    <button
      onClick={isEmpty ? undefined : onClick}
      disabled={isEmpty}
      className={cn(
        "w-full text-left rounded-xl border p-4 transition-all duration-150 group",
        isEmpty
          ? "bg-slate-900/30 border-dashed border-brand-border/50 cursor-default opacity-50"
          : cn(
              "bg-brand-card border-brand-border cursor-pointer",
              "hover:shadow-lg hover:border-slate-600 active:scale-[0.98]",
            )
      )}
    >
      {/* type + arrow */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center border", meta.bg, meta.border)}>
            <Icon className={cn("w-4 h-4", meta.color)} />
          </div>
          <span className={cn("text-sm font-bold", meta.color)}>{meta.label}</span>
        </div>
        {!isEmpty && (
          <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 group-hover:translate-x-0.5 transition-all" />
        )}
      </div>

      {/* scheduled time */}
      <div className="flex items-center gap-1.5 mb-3">
        <Clock className="w-3 h-3 text-brand-text-muted shrink-0" />
        <span className="text-[11px] font-mono text-slate-400">{meta.time}</span>
      </div>

      {/* stats */}
      <div className="flex items-center justify-between pt-3 border-t border-brand-border/50">
        <div className="flex items-center gap-1.5">
          <Users className={cn("w-3.5 h-3.5", count > 0 ? meta.color : "text-slate-600")} />
          <span className="text-[11px] text-slate-400">
            {count} {count === 1 ? "employee" : "employees"}
          </span>
        </div>
        {count > 0 && (
          <div className="flex items-center gap-1">
            <AlertTriangle className={cn("w-3 h-3", alerts > 0 ? "text-brand-warning" : "text-slate-600")} />
            <span className={cn(
              "text-[11px] font-bold",
              alerts === 0 ? "text-slate-600" :
              alerts <= 3  ? "text-brand-warning" :
                             "text-brand-danger"
            )}>
              {alerts} alert{alerts !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>
    </button>
  );
}

// ─── Detail Page ──────────────────────────────────────────────────────────────
const ShiftDetailPage: FC<{
  shiftType: ShiftType;
  date: string;
  shifts: Shift[];
  employees: Employee[];
  onBack: () => void;
}> = ({ shiftType, date, shifts, employees, onBack }) => {
  const meta      = SHIFT_META[shiftType];
  const Icon      = meta.icon;
  const dateLabel = format(parseISO(date + "T00:00:00"), "EEEE, MMMM d, yyyy");

  // Enrich rows
  const rows = shifts.map(shift => {
    const emp      = employees.find(e => e.id === shift.employeeId);
    const workSec  = calcWorkSeconds(shift.aiMetadata?.actualStart, shift.aiMetadata?.actualEnd);
    const alerts   = shift.aiMetadata?.alerts ?? { drowsy: 0, sleep: 0, phone: 0, absence: 0 };
    const ta       = alerts.drowsy + alerts.sleep + alerts.phone + alerts.absence;
    const eff      = calcEfficiency(shift);
    return { shift, emp, workSec, alerts, ta, eff };
  });

  // Sort by efficiency desc by default
  const sorted = [...rows].sort((a, b) => b.eff - a.eff);
  const avgEff  = rows.length ? Math.round(rows.reduce((s, r) => s + r.eff, 0) / rows.length) : 0;
  const maxWork = Math.max(...rows.map(r => r.workSec), 1);
  const maxAlerts = Math.max(...rows.map(r => r.ta), 1);

  const grandAlerts = rows.reduce((a, r) => ({
    drowsy:  a.drowsy  + r.alerts.drowsy,
    sleep:   a.sleep   + r.alerts.sleep,
    phone:   a.phone   + r.alerts.phone,
    absence: a.absence + r.alerts.absence,
  }), { drowsy: 0, sleep: 0, phone: 0, absence: 0 });

  return (
    <motion.div
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 32 }}
      transition={{ duration: 0.22 }}
      className="space-y-6 pb-12"
    >
      {/* ── Top bar ── */}
      <div className={cn("flex items-center justify-between rounded-xl border p-4", meta.bg, meta.border)}>
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-100 transition-colors group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            <span>Back to Reports</span>
          </button>
          <span className="text-slate-600">·</span>
          <div className="flex items-center gap-2">
            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center border", meta.bg, meta.border)}>
              <Icon className={cn("w-4 h-4", meta.color)} />
            </div>
            <div>
              <p className={cn("text-sm font-bold", meta.color)}>{meta.label} Shift</p>
              <p className="text-[11px] text-brand-text-muted">{dateLabel} · {meta.time}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-brand-text-muted">
          <Users className="w-3.5 h-3.5" />
          <span>{shifts.length} employee{shifts.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* ── Summary tiles ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Avg Efficiency", value: `${avgEff}%`, icon: Activity, color: avgEff >= 60 ? "text-brand-success" : avgEff >= 40 ? "text-brand-warning" : "text-brand-danger" },
          { label: "Total Drowsy",   value: grandAlerts.drowsy,  icon: Eye,       color: grandAlerts.drowsy  > 0 ? "text-brand-warning" : "text-slate-600" },
          { label: "Total Sleeping", value: grandAlerts.sleep,   icon: BedDouble, color: grandAlerts.sleep   > 0 ? "text-brand-danger"  : "text-slate-600" },
          { label: "Phone / Absence",value: `${grandAlerts.phone} / ${grandAlerts.absence}`, icon: PhoneCall, color: (grandAlerts.phone + grandAlerts.absence) > 0 ? "text-brand-warning" : "text-slate-600" },
        ].map(tile => {
          const TileIcon = tile.icon;
          return (
            <div key={tile.label} className="bg-brand-card border border-brand-border rounded-xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                <TileIcon className={cn("w-4 h-4", tile.color)} />
              </div>
              <div>
                <p className="text-[10px] text-brand-text-muted uppercase tracking-widest font-bold">{tile.label}</p>
                <p className={cn("text-lg font-bold mt-0.5", tile.color)}>{tile.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      {shifts.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-2 text-brand-text-muted bg-brand-card border border-brand-border rounded-xl">
          <Users className="w-8 h-8 text-slate-700" />
          <p className="text-sm">No employees assigned to this shift.</p>
        </div>
      ) : (
        <>
          {/* ── Attendance & Alerts Table ── */}
          <div className="bg-brand-card border border-brand-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-brand-border">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-brand-accent" />
                <h3 className="text-sm font-bold text-slate-100">Attendance & Alert Breakdown</h3>
              </div>
              <span className="text-[10px] text-brand-text-muted">{shifts.length} record{shifts.length !== 1 ? "s" : ""}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse min-w-[900px]">
                <thead>
                  <tr className="bg-slate-800/80">
                    {[
                      "#", "Employee", "Department", "Status",
                      "Sched. Start", "Sched. End",
                      "Actual Start", "Actual End", "Work Duration",
                      "Drowsy", "Sleeping", "Mobile", "Absence", "Total",
                    ].map(col => (
                      <th key={col} className="text-left px-3 py-3 text-[10px] font-bold uppercase tracking-widest text-brand-text-muted border-b border-brand-border whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(({ shift, emp, workSec, alerts, ta }, idx) => (
                    <tr key={shift.id} className={cn("border-b border-brand-border/40 hover:bg-slate-700/20 transition-colors", idx % 2 === 0 ? "bg-slate-900/20" : "")}>
                      <td className="px-3 py-3 text-slate-500 font-mono">{idx + 1}</td>

                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border shrink-0", meta.bg, meta.border, meta.color)}>
                            {emp?.name.split(" ").map(n => n[0]).join("").slice(0, 2) || "?"}
                          </div>
                          <span className="font-semibold text-slate-100 whitespace-nowrap">{emp?.name || `#${shift.employeeId}`}</span>
                        </div>
                      </td>

                      <td className="px-3 py-3 text-slate-400 whitespace-nowrap">{emp?.department || "—"}</td>

                      <td className="px-3 py-3">
                        <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold",
                          shift.status === "Completed"   ? "bg-brand-success/20 text-brand-success" :
                          shift.status === "Missed"      ? "bg-brand-danger/20  text-brand-danger"  :
                          shift.status === "In Progress" ? "bg-brand-warning/20 text-brand-warning" :
                                                           "bg-brand-accent/20  text-brand-accent"
                        )}>
                          {shift.status || "Scheduled"}
                        </span>
                      </td>

                      <td className="px-3 py-3 font-mono text-slate-300">{meta.scheduledStart}</td>
                      <td className="px-3 py-3 font-mono text-slate-300">{meta.scheduledEnd}</td>

                      <td className="px-3 py-3 font-mono">
                        <span className={shift.aiMetadata?.actualStart && shift.aiMetadata.actualStart !== "--:--:--" ? "text-brand-success" : "text-slate-600"}>
                          {shift.aiMetadata?.actualStart || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-mono">
                        <span className={shift.aiMetadata?.actualEnd && shift.aiMetadata.actualEnd !== "--:--:--" ? "text-brand-danger" : "text-slate-600"}>
                          {shift.aiMetadata?.actualEnd || "—"}
                        </span>
                      </td>

                      <td className="px-3 py-3 font-mono">
                        <span className={workSec > 0 ? "text-brand-accent font-semibold" : "text-slate-600"}>
                          {formatDuration(workSec)}
                        </span>
                      </td>

                      {[alerts.drowsy, alerts.sleep, alerts.phone, alerts.absence].map((n, i) => (
                        <td key={i} className="px-3 py-3 text-center">
                          <span className={cn("font-bold", n === 0 ? "text-slate-600" : n <= 2 ? "text-brand-warning" : "text-brand-danger")}>{n}</span>
                        </td>
                      ))}

                      <td className="px-3 py-3 text-center">
                        <span className={cn("px-2 py-0.5 rounded font-bold text-[11px]",
                          ta === 0 ? "text-slate-600" :
                          ta <= 3  ? "bg-brand-warning/20 text-brand-warning" :
                                     "bg-brand-danger/20  text-brand-danger"
                        )}>{ta}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>

                {/* Totals footer */}
                {sorted.length > 1 && (
                  <tfoot>
                    <tr className="bg-slate-800/70 border-t-2 border-brand-border">
                      <td colSpan={9} className="px-3 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        Totals — {sorted.length} employees
                      </td>
                      {(["drowsy", "sleep", "phone", "absence"] as const).map(key => {
                        const sum = sorted.reduce((a, r) => a + r.alerts[key], 0);
                        return (
                          <td key={key} className="px-3 py-2.5 text-center">
                            <span className={cn("font-bold text-xs", sum > 0 ? "text-brand-warning" : "text-slate-600")}>{sum}</span>
                          </td>
                        );
                      })}
                      <td className="px-3 py-2.5 text-center">
                        {(() => {
                          const grand = sorted.reduce((a, r) => a + r.ta, 0);
                          return <span className={cn("font-bold text-xs px-2 py-0.5 rounded", grand === 0 ? "text-slate-600" : grand <= 5 ? "bg-brand-warning/20 text-brand-warning" : "bg-brand-danger/20 text-brand-danger")}>{grand}</span>;
                        })()}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* ── Work Efficiency Comparison ── */}
          <div className="bg-brand-card border border-brand-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-brand-border">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-brand-accent" />
                <h3 className="text-sm font-bold text-slate-100">Work Efficiency Comparison</h3>
              </div>
              <p className="text-[11px] text-brand-text-muted mt-1">
                Score 0–100 · based on time worked vs 8h shift, penalised 8 pts per alert
              </p>
            </div>

            <div className="p-5 space-y-3">
              {sorted.map(({ shift, emp, workSec, ta, eff }, idx) => {
                const effInfo   = efficiencyLabel(eff);
                const workPct   = Math.min(100, Math.round((workSec / (8 * 3600)) * 100));
                const alertPct  = Math.min(100, Math.round((ta / Math.max(maxAlerts, 1)) * 100));
                const rank      = idx + 1;
                const RankIcon  = rank === 1 ? TrendingUp : rank === sorted.length && sorted.length > 1 ? TrendingDown : Minus;

                return (
                  <div key={shift.id} className="grid grid-cols-12 gap-3 items-center py-3 border-b border-brand-border/40 last:border-0">

                    {/* Rank + name */}
                    <div className="col-span-3 flex items-center gap-2 min-w-0">
                      <div className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                        rank === 1 ? "bg-amber-400/20 text-amber-400" :
                        rank === sorted.length && sorted.length > 1 ? "bg-brand-danger/20 text-brand-danger" :
                        "bg-slate-700 text-slate-400"
                      )}>
                        {rank}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-100 truncate">{emp?.name || `#${shift.employeeId}`}</p>
                        <p className="text-[10px] text-brand-text-muted truncate">{emp?.department || "—"}</p>
                      </div>
                    </div>

                    {/* Efficiency score badge */}
                    <div className="col-span-1 flex justify-center">
                      <span className={cn("px-2 py-1 rounded-lg text-xs font-bold whitespace-nowrap", effInfo.bg, effInfo.color)}>
                        {eff}%
                      </span>
                    </div>

                    {/* Efficiency bar */}
                    <div className="col-span-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[9px] text-brand-text-muted uppercase tracking-widest">Efficiency</span>
                        <span className={cn("text-[9px] font-bold", effInfo.color)}>{effInfo.label}</span>
                      </div>
                      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${eff}%` }}
                          transition={{ duration: 0.6, delay: idx * 0.05 }}
                          className={cn("h-full rounded-full", eff >= 80 ? "bg-brand-success" : eff >= 60 ? "bg-brand-accent" : eff >= 40 ? "bg-brand-warning" : "bg-brand-danger")}
                        />
                      </div>
                    </div>

                    {/* Time worked bar */}
                    <div className="col-span-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[9px] text-brand-text-muted uppercase tracking-widest">Time Worked</span>
                        <span className="text-[9px] font-mono text-slate-400">{formatDuration(workSec)}</span>
                      </div>
                      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${workPct}%` }}
                          transition={{ duration: 0.6, delay: idx * 0.05 + 0.1 }}
                          className="h-full rounded-full bg-brand-accent/70"
                        />
                      </div>
                    </div>

                    {/* Alerts summary */}
                    <div className="col-span-2 flex items-center justify-end gap-3">
                      <div className="text-right">
                        <p className="text-[10px] text-brand-text-muted">Alerts</p>
                        <p className={cn("text-sm font-bold", ta === 0 ? "text-slate-600" : ta <= 3 ? "text-brand-warning" : "text-brand-danger")}>{ta}</p>
                      </div>
                      <RankIcon className={cn("w-4 h-4 shrink-0",
                        rank === 1 ? "text-amber-400" :
                        rank === sorted.length && sorted.length > 1 ? "text-brand-danger" :
                        "text-slate-600"
                      )} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="px-5 pb-4 flex flex-wrap gap-3">
              {[
                { label: "Excellent (80–100%)", color: "bg-brand-success" },
                { label: "Good (60–79%)",       color: "bg-brand-accent"  },
                { label: "Average (40–59%)",    color: "bg-brand-warning" },
                { label: "Poor (<40%)",         color: "bg-brand-danger"  },
              ].map(({ label, color }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div className={cn("w-2.5 h-2.5 rounded-sm", color)} />
                  <span className="text-[10px] text-brand-text-muted">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}

// ─── Grade helpers ────────────────────────────────────────────────────────────
const GRADE_META = {
  Excellent: { color: "text-brand-success", bg: "bg-brand-success/20", border: "border-brand-success/30", icon: Star },
  Good:      { color: "text-brand-accent",  bg: "bg-brand-accent/20",  border: "border-brand-accent/30",  icon: ThumbsUp },
  Poor:      { color: "text-brand-danger",  bg: "bg-brand-danger/20",  border: "border-brand-danger/30",  icon: ThumbsDown },
} as const;

// ─── Full Report Page ─────────────────────────────────────────────────────────
const FullReportPage: FC<{
  from: string;
  to: string;
  onBack: () => void;
}> = ({ from, to, onBack }) => {
  const [rows,    setRows]    = useState<FullReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [filter,  setFilter]  = useState<"All" | "Excellent" | "Good" | "Poor">("All");
  const [sortBy,  setSortBy]  = useState<"date" | "name" | "alerts" | "grade">("date");

  useEffect(() => {
    setLoading(true);
    setError(null);
    getFullReport(from, to)
      .then(r => setRows(r.rows))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [from, to]);

  const fromLabel = format(parseISO(from + "T00:00:00"), "MMM d, yyyy");
  const toLabel   = format(parseISO(to   + "T00:00:00"), "MMM d, yyyy");

  const filtered = useMemo(() => {
    let r = filter === "All" ? rows : rows.filter(x => x.performanceGrade === filter);
    return [...r].sort((a, b) => {
      if (sortBy === "date")   return b.date.localeCompare(a.date) || a.empName.localeCompare(b.empName);
      if (sortBy === "name")   return a.empName.localeCompare(b.empName);
      if (sortBy === "alerts") return b.totalAlerts - a.totalAlerts;
      if (sortBy === "grade") {
        const ord = { Excellent: 0, Good: 1, Poor: 2 };
        return ord[a.performanceGrade] - ord[b.performanceGrade];
      }
      return 0;
    });
  }, [rows, filter, sortBy]);

  // Summary counts
  const summary = useMemo(() => ({
    total:     rows.length,
    excellent: rows.filter(r => r.performanceGrade === "Excellent").length,
    good:      rows.filter(r => r.performanceGrade === "Good").length,
    poor:      rows.filter(r => r.performanceGrade === "Poor").length,
    alerts:    rows.reduce((s, r) => s + r.totalAlerts, 0),
  }), [rows]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 32 }}
      transition={{ duration: 0.22 }}
      className="space-y-6 pb-12"
    >
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between bg-brand-card border border-brand-border p-4 rounded-xl">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-100 transition-colors group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            Back to Reports
          </button>
          <span className="text-slate-600">·</span>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-brand-accent" />
            <div>
              <p className="text-sm font-bold text-slate-100">Full Period Report</p>
              <p className="text-[11px] text-brand-text-muted">{fromLabel} – {toLabel}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-brand-text-muted">
          <Users className="w-3.5 h-3.5" />
          <span>{summary.total} record{summary.total !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* ── Performance Summary tiles ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total Records",  value: summary.total,     icon: FileText,    color: "text-slate-300" },
          { label: "Excellent",      value: summary.excellent, icon: Star,        color: "text-brand-success" },
          { label: "Good",           value: summary.good,      icon: ThumbsUp,    color: "text-brand-accent"  },
          { label: "Poor",           value: summary.poor,      icon: ThumbsDown,  color: "text-brand-danger"  },
          { label: "Total Alerts",   value: summary.alerts,    icon: AlertTriangle, color: summary.alerts > 0 ? "text-brand-warning" : "text-slate-600" },
        ].map(tile => {
          const TIcon = tile.icon;
          return (
            <div key={tile.label} className="bg-brand-card border border-brand-border rounded-xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                <TIcon className={cn("w-4 h-4", tile.color)} />
              </div>
              <div>
                <p className="text-[10px] text-brand-text-muted uppercase tracking-widest font-bold">{tile.label}</p>
                <p className={cn("text-xl font-bold mt-0.5", tile.color)}>{tile.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Performance Note ── */}
      <div className="bg-slate-800/40 border border-brand-border rounded-lg px-4 py-2.5 flex flex-wrap items-center gap-4 text-[11px]">
        <span className="text-brand-text-muted font-semibold uppercase tracking-widest">Performance Scale:</span>
        <span className="flex items-center gap-1.5 text-brand-success"><Star className="w-3 h-3" /> Excellent — 0–4 alerts/shift</span>
        <span className="flex items-center gap-1.5 text-brand-accent"><ThumbsUp className="w-3 h-3" /> Good — 5–8 alerts/shift</span>
        <span className="flex items-center gap-1.5 text-brand-danger"><ThumbsDown className="w-3 h-3" /> Poor — &gt;8 alerts/shift</span>
      </div>

      {/* ── Filters + Sort ── */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[10px] text-brand-text-muted font-semibold uppercase tracking-widest">Filter:</span>
        {(["All", "Excellent", "Good", "Poor"] as const).map(g => (
          <button key={g} onClick={() => setFilter(g)}
            className={cn(
              "text-[11px] px-3 py-1 rounded-md border transition-all font-semibold",
              filter === g
                ? g === "All" ? "bg-slate-700 border-slate-500 text-slate-100"
                  : cn(GRADE_META[g as keyof typeof GRADE_META].bg, GRADE_META[g as keyof typeof GRADE_META].border, GRADE_META[g as keyof typeof GRADE_META].color)
                : "bg-slate-800/60 border-brand-border text-slate-400 hover:text-slate-200"
            )}>
            {g}
            {g !== "All" && <span className="ml-1 opacity-60">({g === "Excellent" ? summary.excellent : g === "Good" ? summary.good : summary.poor})</span>}
          </button>
        ))}
        <span className="text-slate-600 mx-1">|</span>
        <span className="text-[10px] text-brand-text-muted font-semibold uppercase tracking-widest">Sort:</span>
        {(["date", "name", "alerts", "grade"] as const).map(s => (
          <button key={s} onClick={() => setSortBy(s)}
            className={cn(
              "text-[11px] px-2.5 py-1 rounded-md border transition-all capitalize font-medium",
              sortBy === s ? "bg-brand-accent/20 border-brand-accent text-brand-accent"
                           : "bg-slate-800/60 border-brand-border text-slate-400 hover:text-slate-200"
            )}>
            {s}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-brand-text-muted">{filtered.length} row{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* ── Table ── */}
      <div className="bg-brand-card border border-brand-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48 gap-3 text-brand-text-muted">
            <Loader2 className="w-5 h-5 animate-spin text-brand-accent" />
            <span className="text-sm">Calculating performance data…</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-48 text-brand-danger text-sm">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-brand-text-muted">
            <Users className="w-8 h-8 text-slate-700" />
            <p className="text-sm">No records found for this range.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse min-w-[1100px]">
              <thead>
                <tr className="bg-slate-800/80">
                  {[
                    "#", "Date", "Employee", "Department", "Shift",
                    "Sched. Start", "Sched. End",
                    "Actual Start", "Actual End", "Work Duration",
                    "Status", "Drowsy", "Sleeping", "Mobile", "Absence",
                    "Total Alerts", "Performance",
                  ].map(col => (
                    <th key={col} className="text-left px-3 py-3 text-[10px] font-bold uppercase tracking-widest text-brand-text-muted border-b border-brand-border whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, idx) => {
                  const gm      = GRADE_META[row.performanceGrade];
                  const GIcon   = gm.icon;
                  const workSec = row.workSeconds;
                  const wh = Math.floor(workSec / 3600);
                  const wm = Math.floor((workSec % 3600) / 60);
                  const workStr = workSec > 0 ? `${wh}h ${wm.toString().padStart(2,"0")}m` : "—";
                  const ShiftIcon = row.shiftType === "Morning" ? Sun : row.shiftType === "Afternoon" ? Sunset : Moon;
                  const shiftColor = SHIFT_META[row.shiftType as ShiftType].color;

                  return (
                    <tr key={row.id + idx} className={cn("border-b border-brand-border/40 hover:bg-slate-700/20 transition-colors", idx % 2 === 0 ? "bg-slate-900/20" : "")}>
                      <td className="px-3 py-3 text-slate-500 font-mono">{idx + 1}</td>

                      <td className="px-3 py-3 font-mono text-slate-300 whitespace-nowrap">
                        {format(parseISO(row.date + "T00:00:00"), "MMM d, yyyy")}
                        <span className="block text-[10px] text-brand-text-muted">{format(parseISO(row.date + "T00:00:00"), "EEEE")}</span>
                      </td>

                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2 min-w-[120px]">
                          <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border shrink-0", shiftColor, SHIFT_META[row.shiftType as ShiftType].bg, SHIFT_META[row.shiftType as ShiftType].border)}>
                            {row.empName.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                          </div>
                          <div>
                            <p className="font-semibold text-slate-100 whitespace-nowrap">{row.empName}</p>
                            <p className="text-[10px] text-brand-text-muted font-mono">{row.empIdText}</p>
                          </div>
                        </div>
                      </td>

                      <td className="px-3 py-3 text-slate-400 whitespace-nowrap">{row.department}</td>

                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          <ShiftIcon className={cn("w-3.5 h-3.5 shrink-0", shiftColor)} />
                          <span className={cn("font-semibold whitespace-nowrap", shiftColor)}>{row.shiftType}</span>
                        </div>
                      </td>

                      <td className="px-3 py-3 font-mono text-slate-300 whitespace-nowrap">{row.scheduledStart?.slice(0,5) || "—"}</td>
                      <td className="px-3 py-3 font-mono text-slate-300 whitespace-nowrap">{row.scheduledEnd?.slice(0,5)   || "—"}</td>

                      <td className="px-3 py-3 font-mono whitespace-nowrap">
                        <span className={row.actualStart ? "text-brand-success" : "text-slate-600"}>{row.actualStart || "—"}</span>
                      </td>
                      <td className="px-3 py-3 font-mono whitespace-nowrap">
                        <span className={row.actualEnd ? "text-brand-danger" : "text-slate-600"}>{row.actualEnd || "—"}</span>
                      </td>

                      <td className="px-3 py-3 font-mono whitespace-nowrap">
                        <span className={workSec > 0 ? "text-brand-accent font-semibold" : "text-slate-600"}>{workStr}</span>
                      </td>

                      <td className="px-3 py-3">
                        <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold",
                          row.status === "Completed"   ? "bg-brand-success/20 text-brand-success" :
                          row.status === "Missed"      ? "bg-brand-danger/20  text-brand-danger"  :
                          row.status === "In Progress" ? "bg-brand-warning/20 text-brand-warning" :
                                                         "bg-brand-accent/20  text-brand-accent"
                        )}>{row.status || "Scheduled"}</span>
                      </td>

                      {[row.alerts.drowsy, row.alerts.sleep, row.alerts.phone, row.alerts.absence].map((n, i) => (
                        <td key={i} className="px-3 py-3 text-center">
                          <span className={cn("font-bold", n === 0 ? "text-slate-600" : n <= 2 ? "text-brand-warning" : "text-brand-danger")}>{n}</span>
                        </td>
                      ))}

                      <td className="px-3 py-3 text-center">
                        <span className={cn("px-2 py-0.5 rounded font-bold text-[11px]",
                          row.totalAlerts === 0 ? "text-slate-600"
                          : row.totalAlerts <= 4 ? "bg-brand-success/20 text-brand-success"
                          : row.totalAlerts <= 8 ? "bg-brand-warning/20 text-brand-warning"
                          :                        "bg-brand-danger/20  text-brand-danger"
                        )}>{row.totalAlerts}</span>
                      </td>

                      {/* Performance */}
                      <td className="px-3 py-3">
                        <span className={cn("flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-bold w-fit whitespace-nowrap", gm.bg, gm.color)}>
                          <GIcon className="w-3 h-3 shrink-0" />
                          {row.performanceGrade}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
};

// ─── Reports List Page ────────────────────────────────────────────────────────
function ReportsList({
  appliedStart, appliedEnd, appliedDays, shifts, employees, loading, exporting,
  onExportDay, onExportAll, onOpenDetail, onViewReport, onSearch,
}: {
  appliedStart: string;
  appliedEnd: string;
  appliedDays: Date[];
  shifts: Shift[];
  employees: Employee[];
  loading: boolean;
  exporting: string | null;
  onExportDay: (date: string) => void;
  onExportAll: () => void;
  onOpenDetail: (date: string, type: ShiftType) => void;
  onViewReport: (from: string, to: string) => void;
  onSearch: (from: string, to: string) => void;
}) {
  const today    = new Date();
  const todayStr = format(today, "yyyy-MM-dd");

  const [pickerStart, setPickerStart] = useState(appliedStart);
  const [pickerEnd,   setPickerEnd]   = useState(appliedEnd);

  const rangeError = useMemo(() => {
    if (!pickerStart || !pickerEnd) return "Please select both dates.";
    if (isAfter(parseISO(pickerStart), parseISO(pickerEnd))) return "Start date must be before end date.";
    if (differenceInCalendarDays(parseISO(pickerEnd), parseISO(pickerStart)) >= MAX_RANGE_DAYS)
      return `Range too large — max ${MAX_RANGE_DAYS} days.`;
    return null;
  }, [pickerStart, pickerEnd]);

  const getShifts = (date: string, type?: string) =>
    shifts.filter(s => s.date === date && (type ? s.type === type : true));

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between bg-brand-card border border-brand-border p-4 rounded-xl">
        <div className="flex items-center gap-4">
          <FileText className="w-5 h-5 text-brand-accent" />
          <div>
            <h2 className="text-lg font-bold text-slate-100">Daily Activity Reports</h2>
            <p className="text-[11px] text-brand-text-muted mt-0.5">
              {format(parseISO(appliedStart), "MMM d")} – {format(parseISO(appliedEnd), "MMM d, yyyy")}
              {" "}· {appliedDays.length} day{appliedDays.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onExportAll} disabled={!!exporting || loading} className="shrink-0">
          {exporting === "all" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 mr-2 text-emerald-400" />}
          {exporting === "all" ? "Exporting…" : "Export All"}
        </Button>
      </div>

      {/* Date Range Picker */}
      <div className="bg-brand-card border border-brand-border rounded-xl p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-brand-accent" />
          <span className="text-sm font-semibold text-slate-100">Date Range</span>
          <span className="text-[10px] text-brand-text-muted ml-1">(max {MAX_RANGE_DAYS} days)</span>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {(["start", "end"] as const).map(which => {
            const val    = which === "start" ? pickerStart : pickerEnd;
            const setVal = which === "start" ? setPickerStart : setPickerEnd;
            return (
              <div key={which} className="flex flex-col gap-1 min-w-[150px]">
                <label className="text-[10px] font-bold uppercase tracking-widest text-brand-text-muted">
                  {which === "start" ? "From" : "To"}
                </label>
                <div className="relative">
                  <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-accent pointer-events-none" />
                  <input
                    type="date"
                    value={val}
                    max={which === "start" ? (pickerEnd || todayStr) : todayStr}
                    min={which === "end" ? pickerStart : undefined}
                    onChange={e => setVal(e.target.value)}
                    className={cn(
                      "w-full bg-slate-800 border rounded-lg pl-8 pr-3 py-2 text-sm text-slate-100",
                      "focus:outline-none focus:ring-1 focus:ring-brand-accent [color-scheme:dark]",
                      rangeError ? "border-brand-danger/60" : "border-brand-border hover:border-slate-600"
                    )}
                  />
                </div>
              </div>
            );
          })}

          <Button size="sm"
            onClick={() => { if (!rangeError) onSearch(pickerStart, pickerEnd); }}
            disabled={!!rangeError}
          >
            <Search className="w-3.5 h-3.5 mr-1.5" />Search
          </Button>

          <Button size="sm" variant="outline"
            onClick={() => { if (!rangeError) onViewReport(pickerStart, pickerEnd); }}
            disabled={!!rangeError}
            className="border-brand-accent/50 text-brand-accent hover:bg-brand-accent/10"
          >
            <BarChart3 className="w-3.5 h-3.5 mr-1.5" />View Report
          </Button>

          {rangeError && <p className="text-[11px] text-brand-danger font-medium">⚠ {rangeError}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-brand-border/50">
          <span className="text-[10px] text-brand-text-muted font-semibold uppercase tracking-widest mr-1">Quick:</span>
          {[{ label: "Today", days: 1 }, { label: "Last 7d", days: 7 }, { label: "Last 14d", days: 14 }, { label: "Last 30d", days: 30 }].map(({ label, days }) => {
            const ps = format(addDays(today, -(days - 1)), "yyyy-MM-dd");
            const active = appliedStart === ps && appliedEnd === todayStr;
            return (
              <button key={label}
                onClick={() => { const s = format(addDays(today, -(days-1)), "yyyy-MM-dd"); setPickerStart(s); setPickerEnd(todayStr); onSearch(s, todayStr); }}
                className={cn(
                  "text-[11px] px-2.5 py-1 rounded-md border transition-all font-medium",
                  active ? "bg-brand-accent/20 border-brand-accent text-brand-accent"
                         : "bg-slate-800/60 border-brand-border text-slate-400 hover:border-slate-500 hover:text-slate-200"
                )}>
                {label}
              </button>
            );
          })}
          <span className="ml-auto text-[11px] text-brand-text-muted">
            {loading ? "Loading…" : `${shifts.length} record${shifts.length !== 1 ? "s" : ""} found`}
          </span>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center h-40 gap-3 text-brand-text-muted">
          <Loader2 className="w-5 h-5 animate-spin text-brand-accent" />
          <span className="text-sm">Loading report data…</span>
        </div>
      )}

      {/* Day rows */}
      {!loading && appliedDays.map(day => {
        const dateStr       = format(day, "yyyy-MM-dd");
        const isExportingDay = exporting === dateStr;

        return (
          <div key={dateStr} className="grid grid-cols-1 lg:grid-cols-12 gap-4 border-b border-brand-border pb-6 last:border-0">
            {/* Date card */}
            <div className="lg:col-span-2 flex flex-col gap-2">
              <div className="bg-slate-800/50 border border-brand-border rounded-xl p-4 text-center">
                <p className="text-xs font-bold text-brand-accent uppercase tracking-widest mb-1">{format(day, "EEEE")}</p>
                <p className="text-2xl font-bold text-slate-100">{format(day, "MMM d")}</p>
                <p className="text-[10px] text-brand-text-muted mt-1">{format(day, "yyyy")}</p>
              </div>
              <Button
                variant="outline" size="sm"
                className={cn("w-full text-[11px] border-emerald-800/50 text-emerald-400 hover:bg-emerald-900/20 hover:border-emerald-600", isExportingDay && "opacity-60 cursor-not-allowed")}
                onClick={() => onExportDay(dateStr)}
                disabled={!!exporting}
              >
                {isExportingDay ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Download className="w-3 h-3 mr-1.5" />}
                {isExportingDay ? "Exporting…" : "Export Excel"}
              </Button>
            </div>

            {/* Shift cards */}
            <div className="lg:col-span-10 grid grid-cols-1 md:grid-cols-3 gap-4">
              {(["Morning", "Afternoon", "Night"] as const).map(type => (
                <ShiftSummaryCard
                  key={type}
                  type={type}
                  shifts={getShifts(dateStr, type)}
                  onClick={() => onOpenDetail(dateStr, type)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {!loading && appliedDays.length === 0 && (
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-brand-text-muted">
          <Calendar className="w-8 h-8 text-slate-700" />
          <p className="text-sm">Select a valid date range and click <span className="text-brand-accent font-semibold">View Report</span>.</p>
        </div>
      )}
    </div>
  );
}

// ─── Main Export ─────────────────────────────────────────────────────────────
export const Reports = () => {
  const today    = new Date();
  const todayStr = format(today, "yyyy-MM-dd");
  const defaultStart = format(addDays(today, -6), "yyyy-MM-dd");

  const [appliedStart, setAppliedStart] = useState(defaultStart);
  const [appliedEnd,   setAppliedEnd]   = useState(todayStr);
  const [exporting,    setExporting]    = useState<string | null>(null);

  // Drill-down state: null = list view
  const [detail,      setDetail]      = useState<{ date: string; type: ShiftType } | null>(null);
  // Full period report: null = not open
  const [fullReport,  setFullReport]  = useState<{ from: string; to: string } | null>(null);

  const appliedDays = useMemo(() => {
    try {
      return eachDayOfInterval({ start: parseISO(appliedStart), end: parseISO(appliedEnd) }).reverse();
    } catch { return []; }
  }, [appliedStart, appliedEnd]);

  const { shifts, loading } = useShifts({ from: appliedStart, to: appliedEnd });
  const { employees }       = useEmployees();

  const getShifts = (date: string, type?: string) =>
    shifts.filter(s => s.date === date && (type ? s.type === type : true));

  const handleExportDay = async (dateStr: string) => {
    if (exporting) return;
    setExporting(dateStr);
    try { await exportDailyReport(dateStr, getShifts(dateStr), employees); }
    finally { setExporting(null); }
  };

  const handleExportAll = async () => {
    if (exporting) return;
    setExporting("all");
    try {
      await exportAllReports(
        appliedDays.map(d => ({ dateStr: format(d, "yyyy-MM-dd"), shifts: getShifts(format(d, "yyyy-MM-dd")) })),
        employees
      );
    } finally { setExporting(null); }
  };

  return (
    <AnimatePresence mode="wait">
      {fullReport ? (
        <FullReportPage
          key="full"
          from={fullReport.from}
          to={fullReport.to}
          onBack={() => setFullReport(null)}
        />
      ) : detail ? (
        <ShiftDetailPage
          key="detail"
          shiftType={detail.type}
          date={detail.date}
          shifts={getShifts(detail.date, detail.type)}
          employees={employees}
          onBack={() => setDetail(null)}
        />
      ) : (
        <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <ReportsList
            appliedStart={appliedStart}
            appliedEnd={appliedEnd}
            appliedDays={appliedDays}
            shifts={shifts}
            employees={employees}
            loading={loading}
            exporting={exporting}
            onExportDay={handleExportDay}
            onExportAll={handleExportAll}
            onOpenDetail={(date, type) => setDetail({ date, type })}
            onViewReport={(from, to) => setFullReport({ from, to })}
            onSearch={(from, to) => { setAppliedStart(from); setAppliedEnd(to); }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};
