'use client';

import { format, addDays } from "date-fns";
import { cn } from "../lib/utils";
import { Clock } from "lucide-react";
import { useShifts } from "../hooks/useShifts";
import { useEmployees } from "../hooks/useEmployees";

export const ShiftViewer = () => {
  const today = new Date();
  const next7Days = Array.from({ length: 7 }).map((_, i) => addDays(today, i));

  const fromDate = format(today, 'yyyy-MM-dd');
  const toDate = format(addDays(today, 6), 'yyyy-MM-dd');

  const { shifts, loading } = useShifts({ from: fromDate, to: toDate });
  const { employees } = useEmployees();

  const getShiftsForDateAndType = (date: string, type: string) => {
    return shifts.filter(s => s.date === date && s.type === type);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-brand-text-muted">Loading shifts...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      {next7Days.map((day) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        return (
          <div key={dateStr} className="space-y-4">
            <div className="flex items-center gap-3 border-b border-brand-border pb-2">
              <h3 className="text-lg font-bold text-slate-100">{format(day, 'EEEE, MMM d, yyyy')}</h3>
              {dateStr === format(today, 'yyyy-MM-dd') && (
                <span className="text-[10px] bg-brand-accent/20 text-brand-accent px-2 py-0.5 rounded-full font-bold uppercase">Today</span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(['Morning', 'Afternoon', 'Night'] as const).map((type) => {
                const typeShifts = getShiftsForDateAndType(dateStr, type);
                return (
                  <div key={type} className="bg-brand-card border border-brand-border rounded-xl p-4 flex flex-col min-h-[150px]">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-xs font-bold text-brand-text-muted uppercase tracking-widest flex items-center gap-2">
                        <Clock className="w-3 h-3 text-brand-accent" />
                        {type}
                      </h4>
                      <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">{typeShifts.length}</span>
                    </div>

                    <div className="flex-1 space-y-2">
                      {typeShifts.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-[10px] text-brand-text-muted italic border border-dashed border-brand-border rounded-lg">
                          No assignments
                        </div>
                      ) : (
                        typeShifts.map((shift) => {
                          const employee = employees.find(e => e.id === shift.employeeId);
                          return (
                            <div key={shift.id} className="bg-slate-800/50 border border-brand-border rounded-lg p-3 flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-brand-accent/10 flex items-center justify-center text-brand-accent font-bold text-xs">
                                {employee?.name.split(' ').map(n => n[0]).join('') || '?'}
                              </div>
                              <div>
                                <p className="text-sm font-medium text-slate-100">{employee?.name || 'Unknown'}</p>
                                <p className="text-[10px] text-brand-text-muted">{employee?.department}</p>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};
