import { useState } from "react";
import { Search, Filter, BarChart2, TrendingUp, ArrowLeft } from "lucide-react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { Employee } from "../types";
import { useEmployees } from "../hooks/useEmployees";
import { getEmployeePerformance, EmployeePerformance } from "../api/employees";
import { format, subDays } from "date-fns";

const todayStr = format(new Date(), "yyyy-MM-dd");
const thirtyDaysAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");

const gradeColor: Record<string, string> = {
  Excellent: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
  Good:      "text-brand-accent bg-brand-accent/10 border-brand-accent/30",
  Fair:      "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
  Poor:      "text-red-400 bg-red-400/10 border-red-400/30",
};

const statusColor: Record<string, string> = {
  Completed:    "text-emerald-400",
  Missed:       "text-red-400",
  Scheduled:    "text-slate-400",
  "In Progress": "text-yellow-400",
};

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="p-5 bg-slate-800/60 rounded-xl border border-brand-border">
      <p className="text-[10px] uppercase tracking-widest text-brand-text-muted mb-2">{label}</p>
      <p className="text-3xl font-bold text-slate-100">{value}</p>
    </div>
  );
}

function AlertPill({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className={`flex items-center justify-between px-4 py-3 rounded-xl border ${color}`}>
      <span className="text-sm font-medium capitalize">{label}</span>
      <span className="text-xl font-bold ml-6">{count}</span>
    </div>
  );
}

function PerformanceReportPage({
  data,
  onBack,
  onChangeDates,
}: {
  data: EmployeePerformance;
  onBack: () => void;
  onChangeDates: () => void;
}) {
  const { employee, period, summary, shifts } = data;

  return (
    <div className="space-y-8">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-brand-text-muted hover:text-slate-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Employees
        </button>
        <Button variant="outline" size="sm" onClick={onChangeDates}>
          Change Date Range
        </Button>
      </div>

      {/* Employee hero card */}
      <div className="flex items-center gap-5 p-6 bg-brand-card border border-brand-border rounded-2xl">
        <div className="w-16 h-16 rounded-full bg-brand-accent/15 flex items-center justify-center text-brand-accent font-bold text-2xl shrink-0">
          {employee.name.split(" ").map((n) => n[0]).join("")}
        </div>
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-slate-100">{employee.name}</h2>
          <p className="text-sm text-brand-text-muted mt-0.5">
            {employee.department} · ID: {employee.id}
          </p>
          <div className="flex items-center gap-3 mt-2">
            <Badge variant={employee.active ? "success" : "neutral"}>
              {employee.active ? "Active" : "Inactive"}
            </Badge>
            <span className="text-xs text-brand-text-muted">
              Report period:{" "}
              <span className="text-slate-300 font-medium">
                {format(new Date(period.from + "T00:00:00"), "MMM d, yyyy")} –{" "}
                {format(new Date(period.to + "T00:00:00"), "MMM d, yyyy")}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* Performance Summary */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-text-muted mb-4">
          Performance Summary
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatBox label="Total Shifts" value={summary.totalShifts} />
          <StatBox label="Completed" value={summary.completed} />
          <StatBox label="Missed" value={summary.missed} />
          <StatBox label="Attendance Rate" value={`${summary.attendanceRate}%`} />
        </div>
      </div>

      {/* Alert Breakdown */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-text-muted mb-4">
          Alert Breakdown{" "}
          <span className="normal-case font-normal text-brand-text-muted">
            — {summary.alertTotal} total alerts in period
          </span>
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <AlertPill label="Drowsy"  count={summary.alertBreakdown.drowsy}  color="text-yellow-400 border-yellow-400/25 bg-yellow-400/5" />
          <AlertPill label="Sleep"   count={summary.alertBreakdown.sleep}   color="text-red-400 border-red-400/25 bg-red-400/5" />
          <AlertPill label="Phone"   count={summary.alertBreakdown.phone}   color="text-blue-400 border-blue-400/25 bg-blue-400/5" />
          <AlertPill label="Absence" count={summary.alertBreakdown.absence} color="text-orange-400 border-orange-400/25 bg-orange-400/5" />
        </div>
      </div>

      {/* Shift Details Table */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-text-muted mb-4">
          Shift Details
        </p>
        {shifts.length === 0 ? (
          <div className="py-16 text-center text-brand-text-muted bg-slate-800/40 rounded-2xl border border-brand-border">
            No shifts found in this date range
          </div>
        ) : (
          <div className="rounded-2xl border border-brand-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-slate-800/70 text-brand-text-muted text-[10px] uppercase tracking-wider">
                    <th className="px-5 py-4 font-semibold">Date</th>
                    <th className="px-5 py-4 font-semibold">Shift</th>
                    <th className="px-5 py-4 font-semibold">Status</th>
                    <th className="px-5 py-4 font-semibold">Check-in</th>
                    <th className="px-5 py-4 font-semibold">Check-out</th>
                    <th className="px-5 py-4 font-semibold text-center">Drowsy</th>
                    <th className="px-5 py-4 font-semibold text-center">Sleep</th>
                    <th className="px-5 py-4 font-semibold text-center">Phone</th>
                    <th className="px-5 py-4 font-semibold text-center">Absence</th>
                    <th className="px-5 py-4 font-semibold">Grade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-border">
                  {shifts.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-5 py-4 font-mono text-xs text-slate-300 whitespace-nowrap">
                        {format(new Date(s.date + "T00:00:00"), "MMM d, yyyy")}
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <span className="text-sm text-slate-300">{s.shiftType}</span>
                        <span className="text-xs text-brand-text-muted ml-1.5">
                          {s.startTime}–{s.endTime}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`text-xs font-medium ${statusColor[s.status] ?? "text-slate-400"}`}>
                          {s.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-xs font-mono text-slate-300">
                        {s.checkIn ?? <span className="text-brand-text-muted">—</span>}
                      </td>
                      <td className="px-5 py-4 text-xs font-mono text-slate-300">
                        {s.checkOut ?? <span className="text-brand-text-muted">—</span>}
                      </td>
                      <td className="px-5 py-4 text-center text-xs font-semibold text-yellow-400">
                        {s.alerts.drowsy || <span className="text-brand-text-muted font-normal">0</span>}
                      </td>
                      <td className="px-5 py-4 text-center text-xs font-semibold text-red-400">
                        {s.alerts.sleep || <span className="text-brand-text-muted font-normal">0</span>}
                      </td>
                      <td className="px-5 py-4 text-center text-xs font-semibold text-blue-400">
                        {s.alerts.phone || <span className="text-brand-text-muted font-normal">0</span>}
                      </td>
                      <td className="px-5 py-4 text-center text-xs font-semibold text-orange-400">
                        {s.alerts.absence || <span className="text-brand-text-muted font-normal">0</span>}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${gradeColor[s.grade]}`}>
                          {s.grade}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const Employees = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const { employees, loading } = useEmployees(searchTerm);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  // Performance flow
  const [isDateModalOpen, setIsDateModalOpen] = useState(false);
  const [dateRange, setDateRange] = useState({ from: thirtyDaysAgo, to: todayStr });
  const [perfLoading, setPerfLoading] = useState(false);
  const [perfError, setPerfError] = useState("");
  const [perfData, setPerfData] = useState<EmployeePerformance | null>(null);

  const openDateModal = (emp: Employee) => {
    setSelectedEmployee(emp);
    setPerfError("");
    setIsDateModalOpen(true);
  };

  const handleViewPerformance = async () => {
    if (!selectedEmployee || !dateRange.from || !dateRange.to) {
      setPerfError("Please select both start and end dates.");
      return;
    }
    if (dateRange.from > dateRange.to) {
      setPerfError("Start date must be before end date.");
      return;
    }
    setPerfError("");
    setPerfLoading(true);
    try {
      const data = await getEmployeePerformance(selectedEmployee.id, dateRange.from, dateRange.to);
      setPerfData(data);
      setIsDateModalOpen(false);
    } catch (err: any) {
      setPerfError(err.message || "Failed to load performance data.");
    } finally {
      setPerfLoading(false);
    }
  };

  // Full-page report view
  if (perfData) {
    return (
      <PerformanceReportPage
        data={perfData}
        onBack={() => setPerfData(null)}
        onChangeDates={() => {
          setPerfData(null);
          setIsDateModalOpen(true);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-muted" />
          <input
            type="text"
            placeholder="Search by name or ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-brand-card border border-brand-border rounded-lg pl-10 pr-4 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-brand-accent"
          />
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm">
            <Filter className="w-4 h-4 mr-2" />
            Filter
          </Button>
        </div>
      </div>

      <div className="bg-brand-card border border-brand-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-800/50 text-brand-text-muted text-xs uppercase tracking-wider">
                <th className="px-6 py-4 font-semibold">Employee</th>
                <th className="px-6 py-4 font-semibold">ID</th>
                <th className="px-6 py-4 font-semibold">Department</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                <th className="px-6 py-4 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-brand-text-muted">Loading...</td>
                </tr>
              ) : employees.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-brand-text-muted">No employees found</td>
                </tr>
              ) : (
                employees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-brand-accent/10 flex items-center justify-center text-brand-accent font-bold text-xs">
                          {emp.name.split(" ").map((n) => n[0]).join("")}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-100">{emp.name}</p>
                          <p className="text-xs text-brand-text-muted">{emp.department}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-brand-text-muted">{emp.id}</td>
                    <td className="px-6 py-4 text-sm text-slate-300">{emp.department}</td>
                    <td className="px-6 py-4">
                      <Badge variant={emp.active ? "success" : "neutral"}>
                        {emp.active ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setSelectedEmployee(emp); setIsDetailModalOpen(true); }}
                        >
                          View
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openDateModal(emp)}>
                          <BarChart2 className="w-3.5 h-3.5 mr-1.5" />
                          Performance
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Employee Details Modal */}
      <Modal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        title="Employee Details"
        footer={<Button variant="outline" onClick={() => setIsDetailModalOpen(false)}>Close</Button>}
      >
        {selectedEmployee && (
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-brand-accent/10 flex items-center justify-center text-brand-accent font-bold text-xl">
                {selectedEmployee.name.split(" ").map((n) => n[0]).join("")}
              </div>
              <div>
                <h4 className="text-xl font-bold text-slate-100">{selectedEmployee.name}</h4>
                <p className="text-brand-text-muted">{selectedEmployee.department}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-slate-800/50 rounded-lg border border-brand-border">
                <p className="text-[10px] uppercase tracking-wider text-brand-text-muted mb-1">Status</p>
                <Badge variant={selectedEmployee.active ? "success" : "neutral"}>
                  {selectedEmployee.active ? "Active" : "Inactive"}
                </Badge>
              </div>
              <div className="p-3 bg-slate-800/50 rounded-lg border border-brand-border">
                <p className="text-[10px] uppercase tracking-wider text-brand-text-muted mb-1">Department</p>
                <p className="text-sm font-medium text-slate-100">{selectedEmployee.department}</p>
              </div>
              <div className="p-3 bg-slate-800/50 rounded-lg border border-brand-border col-span-2">
                <p className="text-[10px] uppercase tracking-wider text-brand-text-muted mb-1">Employee ID</p>
                <p className="text-sm font-medium font-mono text-slate-100">{selectedEmployee.id}</p>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Date Range Picker Modal */}
      <Modal
        isOpen={isDateModalOpen}
        onClose={() => setIsDateModalOpen(false)}
        title="Employee Performance Report"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsDateModalOpen(false)}>Cancel</Button>
            <Button onClick={handleViewPerformance} disabled={perfLoading}>
              <TrendingUp className="w-3.5 h-3.5 mr-1.5" />
              {perfLoading ? "Loading..." : "View Performance"}
            </Button>
          </>
        }
      >
        {selectedEmployee && (
          <div className="space-y-5">
            <div className="flex items-center gap-3 p-3 bg-slate-800/60 border border-brand-border rounded-xl">
              <div className="w-10 h-10 rounded-full bg-brand-accent/15 flex items-center justify-center text-brand-accent font-bold shrink-0">
                {selectedEmployee.name.split(" ").map((n) => n[0]).join("")}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-100">{selectedEmployee.name}</p>
                <p className="text-xs text-brand-text-muted">{selectedEmployee.department} · {selectedEmployee.id}</p>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-brand-text-muted mb-3">
                Select Date Range
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] text-brand-text-muted uppercase mb-1.5">Start Date</label>
                  <input
                    type="date"
                    value={dateRange.from}
                    onChange={(e) => setDateRange((p) => ({ ...p, from: e.target.value }))}
                    className="w-full bg-slate-800 border border-brand-border rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-brand-accent"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-brand-text-muted uppercase mb-1.5">End Date</label>
                  <input
                    type="date"
                    value={dateRange.to}
                    onChange={(e) => setDateRange((p) => ({ ...p, to: e.target.value }))}
                    className="w-full bg-slate-800 border border-brand-border rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-brand-accent"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {[
                  { label: "Last 7 days",  days: 7 },
                  { label: "Last 30 days", days: 30 },
                  { label: "Last 90 days", days: 90 },
                ].map(({ label, days }) => (
                  <button
                    key={days}
                    onClick={() =>
                      setDateRange({
                        from: format(subDays(new Date(), days), "yyyy-MM-dd"),
                        to: todayStr,
                      })
                    }
                    className="text-xs px-3 py-1 rounded-full border border-brand-border text-brand-text-muted hover:border-brand-accent hover:text-brand-accent transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {perfError && (
              <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {perfError}
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};
