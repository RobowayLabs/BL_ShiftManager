import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, AlertCircle, Clock, Download, FileText, CheckCircle2, Trash2 } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths } from "date-fns";
import { Button } from "../components/Button";
import { cn } from "../lib/utils";
import { Modal } from "../components/Modal";
import { motion, AnimatePresence } from "motion/react";
import { useShifts } from "../hooks/useShifts";
import { useEmployees } from "../hooks/useEmployees";
import { useAuth } from "../context/AuthContext";
import { createShift, deleteShift, updateShift } from "../api/shifts";
import { Shift } from "../types";

// Color styles per shift type — used for both calendar badges and the legend
const shiftTypeStyles: Record<string, string> = {
  Morning:   'bg-brand-accent/20 text-brand-accent border-brand-accent/30',
  Afternoon: 'bg-brand-warning/20 text-brand-warning border-brand-warning/30',
  Night:     'bg-brand-danger/20 text-brand-danger border-brand-danger/30',
};

export const ShiftPlanner = () => {
  const { isSuperAdmin } = useAuth();
  const [currentDate, setCurrentDate] = useState(new Date());
  const { shifts, refetch: refetchShifts } = useShifts();
  const { employees } = useEmployees();

  // ── Add-shift modal ─────────────────────────────────────────────────────────
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [selectedShiftType, setSelectedShiftType] = useState<'Morning' | 'Afternoon' | 'Night'>('Morning');
  const [saving, setSaving] = useState(false);

  // ── Edit/cancel modal ───────────────────────────────────────────────────────
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editShiftType, setEditShiftType] = useState<'Morning' | 'Afternoon' | 'Night'>('Morning');
  const [editShiftStatus, setEditShiftStatus] = useState('Scheduled');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [updating, setUpdating] = useState(false);

  // ── Shared ──────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ message: string; show: boolean }>({ message: "", show: false });

  const days = eachDayOfInterval({
    start: startOfMonth(currentDate),
    end: endOfMonth(currentDate),
  });

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));

  const showToast = (message: string) => {
    setToast({ message, show: true });
    setTimeout(() => setToast({ message: "", show: false }), 3000);
  };

  // ── Add-shift handlers ──────────────────────────────────────────────────────
  const handleDayClick = (day: Date) => {
    if (!isSuperAdmin) return;
    setSelectedDay(day);
    setSelectedEmployeeId("");
    setSelectedShiftType('Morning');
    setIsModalOpen(true);
  };

  const handleSaveShift = async () => {
    if (!selectedEmployeeId || !selectedDay) return;
    const employee = employees.find(e => e.id === selectedEmployeeId);
    if (!employee) return;

    setSaving(true);
    try {
      const dateStr = format(selectedDay, 'yyyy-MM-dd');
      await createShift({ employeeId: selectedEmployeeId, date: dateStr, type: selectedShiftType });
      await refetchShifts();
      setIsModalOpen(false);
      showToast(`Added: ${employee.name} → ${selectedShiftType}`);
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // ── Edit/cancel handlers ────────────────────────────────────────────────────
  const handleShiftBadgeClick = (e: React.MouseEvent, shift: Shift) => {
    if (!isSuperAdmin) return;
    e.stopPropagation(); // don't also open the "Add" modal
    setEditingShift(shift);
    setEditShiftType(shift.type);
    setEditShiftStatus(shift.status || 'Scheduled');
    setConfirmingDelete(false);
    setIsEditModalOpen(true);
  };

  const closeEditModal = () => {
    setIsEditModalOpen(false);
    setConfirmingDelete(false);
  };

  const handleUpdateShift = async () => {
    if (!editingShift || updating) return;
    setUpdating(true);
    try {
      await updateShift(editingShift.id, { type: editShiftType, status: editShiftStatus });
      await refetchShifts();
      closeEditModal();
      showToast('Shift updated successfully');
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    } finally {
      setUpdating(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!editingShift) return;
    try {
      await deleteShift(editingShift.id);
      await refetchShifts();
      closeEditModal();
      showToast('Shift cancelled successfully');
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  };

  const handleExport = (type: 'pdf' | 'excel') => {
    showToast(`Exporting shift data to ${type.toUpperCase()}...`);
  };

  // Helper: get employee display name for a shift
  const empName = (employeeId: string) =>
    employees.find(e => e.id === employeeId)?.name || employeeId;

  return (
    <div className="space-y-6 relative">
      {/* ── Toast notification ──────────────────────────────────────────── */}
      <AnimatePresence>
        {toast.show && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 20 }}
            exit={{ opacity: 0, y: -50 }}
            className="fixed top-4 right-8 z-[100] bg-brand-accent text-slate-900 px-6 py-3 rounded-lg shadow-2xl flex items-center gap-3 font-semibold"
          >
            <CheckCircle2 className="w-5 h-5" />
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold text-slate-100">{format(currentDate, 'MMMM yyyy')}</h2>
          <div className="flex items-center bg-brand-card border border-brand-border rounded-lg p-1">
            <Button variant="ghost" size="sm" onClick={prevMonth} className="px-2">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={nextMonth} className="px-2">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => handleExport('pdf')}>
            <FileText className="w-4 h-4 mr-2" />
            Export PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport('excel')}>
            <Download className="w-4 h-4 mr-2" />
            Export Excel
          </Button>
          {isSuperAdmin && (
            <Button onClick={() => { setSelectedDay(null); setIsModalOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              Assign Shift
            </Button>
          )}
        </div>
      </div>

      {/* ── Calendar grid ───────────────────────────────────────────────── */}
      <div className="bg-brand-card border border-brand-border rounded-xl overflow-hidden shadow-xl">
        {/* Day-of-week header */}
        <div className="grid grid-cols-7 border-b border-brand-border bg-slate-800/50">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div key={day} className="py-3 text-center text-xs font-semibold text-brand-text-muted uppercase tracking-widest">
              {day}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 auto-rows-[120px]">
          {/* Leading empty cells */}
          {Array.from({ length: startOfMonth(currentDate).getDay() }).map((_, i) => (
            <div key={`empty-${i}`} className="border-r border-b border-brand-border bg-slate-900/20" />
          ))}

          {days.map((day) => {
            const dayStr = format(day, 'yyyy-MM-dd');
            const dayShifts = shifts.filter(s => s.date === dayStr);

            return (
              <div
                key={day.toString()}
                onClick={() => handleDayClick(day)}
                className={cn(
                  "border-r border-b border-brand-border p-2 transition-colors relative group",
                  isSuperAdmin ? "cursor-pointer hover:bg-slate-800/50" : "cursor-default",
                  isSameDay(day, new Date()) && "bg-brand-accent/5"
                )}
              >
                {/* Day number */}
                <span className={cn(
                  "text-sm font-medium",
                  isSameDay(day, new Date()) ? "text-brand-accent" : "text-slate-400"
                )}>
                  {format(day, 'd')}
                </span>

                {/* Shift badges */}
                <div className="mt-1 space-y-1 overflow-y-auto max-h-[80px] custom-scrollbar">
                  {dayShifts.map(shift => (
                    <div
                      key={shift.id}
                      onClick={(e) => handleShiftBadgeClick(e, shift)}
                      title={`${shift.type}: ${empName(shift.employeeId)}${isSuperAdmin ? ' — click to edit' : ''}`}
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded border truncate select-none",
                        shiftTypeStyles[shift.type] ?? shiftTypeStyles.Morning,
                        isSuperAdmin && "cursor-pointer hover:brightness-125 active:scale-95 transition-all"
                      )}
                    >
                      <span className="font-bold">{shift.type[0]}·</span>{' '}
                      {empName(shift.employeeId)}
                    </div>
                  ))}
                </div>

                {/* "+" hint on hover for empty add area */}
                {isSuperAdmin && (
                  <div className="absolute bottom-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Plus className="w-3 h-3 text-brand-text-muted" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Legend ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-6 text-xs text-brand-text-muted">
        {(['Morning', 'Afternoon', 'Night'] as const).map(type => (
          <div key={type} className="flex items-center gap-2">
            <div className={cn("w-3 h-3 rounded border", shiftTypeStyles[type])} />
            <span>{type}</span>
          </div>
        ))}
        {isSuperAdmin && (
          <span className="ml-auto text-brand-text-muted/50 italic text-[11px]">
            Click a shift badge to edit or cancel · Click a day cell to add
          </span>
        )}
      </div>

      {/* ══ Modal: Add New Shift ════════════════════════════════════════════ */}
      {isSuperAdmin && (
        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title="Assign New Shift"
          footer={
            <>
              <Button variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveShift} disabled={!selectedEmployeeId || saving}>
                {saving ? 'Saving...' : 'Save Assignment'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-brand-text-muted uppercase mb-1.5">Employee</label>
              <select
                value={selectedEmployeeId}
                onChange={(e) => setSelectedEmployeeId(e.target.value)}
                className="w-full bg-slate-800 border border-brand-border rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-brand-accent"
              >
                <option value="">Select Employee...</option>
                {employees.map(e => (
                  <option key={e.id} value={e.id}>{e.name} ({e.department})</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-brand-text-muted uppercase mb-1.5">Shift Type</label>
                <select
                  value={selectedShiftType}
                  onChange={(e) => setSelectedShiftType(e.target.value as any)}
                  className="w-full bg-slate-800 border border-brand-border rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-brand-accent"
                >
                  <option value="Morning">Morning (08:00 – 16:00)</option>
                  <option value="Afternoon">Afternoon (16:00 – 00:00)</option>
                  <option value="Night">Night (00:00 – 08:00)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-brand-text-muted uppercase mb-1.5">Date</label>
                <div className="flex items-center bg-slate-800 border border-brand-border rounded-lg px-3 py-2 text-sm text-slate-100">
                  <Clock className="w-4 h-4 mr-2 text-brand-text-muted" />
                  {selectedDay ? format(selectedDay, 'MMM d, yyyy') : 'Select a day on the calendar'}
                </div>
              </div>
            </div>

            {selectedEmployeeId && (
              <div className="p-3 bg-brand-warning/5 border border-brand-warning/20 rounded-lg flex gap-3">
                <AlertCircle className="w-5 h-5 text-brand-warning shrink-0" />
                <div>
                  <p className="text-xs font-bold text-brand-warning uppercase">System Check</p>
                  <p className="text-xs text-brand-warning/80">
                    Verifying availability for {employees.find(e => e.id === selectedEmployeeId)?.name}...
                  </p>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ══ Modal: Manage (Edit / Cancel) Shift ════════════════════════════ */}
      {isSuperAdmin && editingShift && (
        <Modal
          isOpen={isEditModalOpen}
          onClose={closeEditModal}
          title="Manage Shift"
          footer={
            <div className="flex items-center justify-between w-full">
              {/* Left: two-step cancel */}
              {confirmingDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-brand-danger font-medium">Confirm cancellation?</span>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                    No
                  </Button>
                  <Button variant="danger" size="sm" onClick={handleConfirmCancel}>
                    Yes, Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-brand-danger/40 text-brand-danger hover:bg-brand-danger/10 hover:border-brand-danger"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  Cancel Shift
                </Button>
              )}

              {/* Right: save / close */}
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={closeEditModal}>
                  Close
                </Button>
                <Button size="sm" onClick={handleUpdateShift} disabled={updating}>
                  {updating ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-4">
            {/* Employee + date info header */}
            <div className="p-3 bg-slate-800 rounded-lg flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-brand-accent/20 flex items-center justify-center text-brand-accent font-bold text-sm shrink-0">
                {empName(editingShift.employeeId)[0] ?? '?'}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-100 truncate">
                  {empName(editingShift.employeeId)}
                </p>
                <p className="text-xs text-brand-text-muted">
                  {format(new Date(editingShift.date + 'T00:00:00'), 'EEEE, MMM d, yyyy')}
                  {editingShift.startTime && editingShift.endTime
                    ? ` · ${editingShift.startTime} – ${editingShift.endTime}`
                    : ''}
                </p>
              </div>
              {/* Current type chip */}
              <div className={cn(
                "ml-auto shrink-0 text-[10px] px-2 py-1 rounded border font-semibold",
                shiftTypeStyles[editingShift.type] ?? shiftTypeStyles.Morning
              )}>
                {editingShift.type}
              </div>
            </div>

            {/* Editable fields */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-brand-text-muted uppercase mb-1.5">
                  Change Shift Type
                </label>
                <select
                  value={editShiftType}
                  onChange={(e) => setEditShiftType(e.target.value as any)}
                  className="w-full bg-slate-800 border border-brand-border rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-brand-accent"
                >
                  <option value="Morning">Morning (08:00 – 16:00)</option>
                  <option value="Afternoon">Afternoon (16:00 – 00:00)</option>
                  <option value="Night">Night (00:00 – 08:00)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-brand-text-muted uppercase mb-1.5">
                  Status
                </label>
                <select
                  value={editShiftStatus}
                  onChange={(e) => setEditShiftStatus(e.target.value)}
                  className="w-full bg-slate-800 border border-brand-border rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-brand-accent"
                >
                  <option value="Scheduled">Scheduled</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Completed">Completed</option>
                  <option value="Missed">Missed</option>
                </select>
              </div>
            </div>
          </div>
        </Modal>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #475569; }
      `}</style>
    </div>
  );
};
