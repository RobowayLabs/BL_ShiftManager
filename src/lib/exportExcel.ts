/**
 * Banglalink NOC — Excel Report Generator
 * Uses ExcelJS to produce a styled, multi-section daily shift report.
 */
import ExcelJS from 'exceljs';
import { format, parseISO } from 'date-fns';
import { Shift, Employee } from '../types';

// ─── Palette ───────────────────────────────────────────────────────────────
const C = {
  navyBg:    'FF0F172A', // slate-900
  tealDark:  'FF0E7490', // brand-accent dark
  tealMid:   'FF0891B2', // cyan-600
  tealLight: 'FFE0F7FA', // very light teal
  headerBg:  'FF164E63', // column-header row background
  evenRow:   'FFF8FAFC', // slate-50
  oddRow:    'FFFFFFFF', // white
  alertRed:  'FFDC2626', // red-600
  alertAmb:  'FFD97706', // amber-600
  alertGray: 'FF94A3B8', // slate-400
  statusBlue:'FF2563EB', // blue-600
  statusGrn: 'FF059669', // green-600
  statusOrg: 'FFD97706', // amber-600
  statusRed: 'FFDC2626', // red-600
  white:     'FFFFFFFF',
  slate100:  'FFF1F5F9',
  slate200:  'FFE2E8F0',
  slate500:  'FF64748B',
  black:     'FF000000',
  totalsBg:  'FF1E293B', // slate-800 — totals row
};

// ─── Helpers ───────────────────────────────────────────────────────────────
function calcWorkDuration(start?: string, end?: string): string {
  if (!start || !end || start === '--:--:--' || end === '--:--:--') return '—';
  const toSec = (t: string) => {
    const [h, m, s] = t.split(':').map(Number);
    return h * 3600 + m * 60 + (s || 0);
  };
  let diff = toSec(end) - toSec(start);
  if (diff < 0) diff += 86400; // overnight
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

function statusColor(status?: string): string {
  switch (status) {
    case 'Completed':   return C.statusGrn;
    case 'In Progress': return C.statusOrg;
    case 'Missed':      return C.statusRed;
    default:            return C.statusBlue; // Scheduled
  }
}

function alertColor(count: number): string {
  if (count === 0) return C.alertGray;
  if (count <= 2)  return C.alertAmb;
  return C.alertRed;
}

type Border = ExcelJS.Border;
type FillPattern = ExcelJS.FillPattern;

const thinBorder: Partial<Border> = { style: 'thin', color: { argb: C.slate200 } };
const thickBorder: Partial<Border> = { style: 'medium', color: { argb: C.tealDark } };

function cellBorders(
  top?: Partial<Border>,
  right?: Partial<Border>,
  bottom?: Partial<Border>,
  left?: Partial<Border>
): Partial<ExcelJS.Borders> {
  return { top, right, bottom, left };
}

const allThin: Partial<ExcelJS.Borders> = {
  top: thinBorder, right: thinBorder, bottom: thinBorder, left: thinBorder,
};

function solidFill(argb: string): FillPattern {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function shiftStartEnd(type: string): { start: string; end: string } {
  switch (type) {
    case 'Morning':   return { start: '08:00:00', end: '16:00:00' };
    case 'Afternoon': return { start: '16:00:00', end: '00:00:00' };
    case 'Night':     return { start: '00:00:00', end: '08:00:00' };
    default:          return { start: '—', end: '—' };
  }
}

// ─── Column Definitions ────────────────────────────────────────────────────
const COLUMNS = [
  { header: '#',           key: 'no',           width: 5  },
  { header: 'Employee',    key: 'name',          width: 24 },
  { header: 'Department',  key: 'department',    width: 16 },
  { header: 'Shift',       key: 'shift',         width: 13 },
  { header: 'Sched. Start',key: 'schedStart',    width: 14 },
  { header: 'Sched. End',  key: 'schedEnd',      width: 13 },
  { header: 'Actual Start',key: 'actualStart',   width: 14 },
  { header: 'Actual End',  key: 'actualEnd',     width: 13 },
  { header: 'Break Time',  key: 'breakTime',     width: 13 },
  { header: 'Work Duration',key:'workDuration',  width: 15 },
  { header: 'Status',      key: 'status',        width: 14 },
  { header: 'Drowsy',      key: 'drowsy',        width: 10 },
  { header: 'Sleeping',    key: 'sleep',         width: 10 },
  { header: 'Mobile Use',  key: 'phone',         width: 11 },
  { header: 'Absence',     key: 'absence',       width: 10 },
  { header: 'Total Alerts',key: 'totalAlerts',   width: 13 },
] as const;

const NCOLS = COLUMNS.length; // 16
const LAST_COL = String.fromCharCode(64 + NCOLS); // 'P'

// ─── Sheet Builder ─────────────────────────────────────────────────────────
function buildDaySheet(
  sheet: ExcelJS.Worksheet,
  dateStr: string,
  shifts: Shift[],
  employees: Employee[]
) {
  const dayLabel = format(parseISO(dateStr), 'EEEE, MMMM d, yyyy');

  // Freeze header rows
  sheet.views = [{ state: 'frozen', ySplit: 6, xSplit: 0 }];

  // Set column widths
  COLUMNS.forEach((col, i) => {
    sheet.getColumn(i + 1).width = col.width;
  });

  // ── Row 1: Company Title ─────────────────────────────────────────────────
  sheet.mergeCells(`A1:${LAST_COL}1`);
  const r1 = sheet.getRow(1);
  r1.height = 38;
  const titleCell = sheet.getCell('A1');
  titleCell.value = '🏢  BANGLALINK NOC — Daily Shift Report';
  titleCell.font  = { name: 'Calibri', bold: true, size: 18, color: { argb: C.white } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill  = solidFill(C.navyBg);

  // ── Row 2: Subtitle bar ──────────────────────────────────────────────────
  sheet.mergeCells(`A2:H2`);
  sheet.mergeCells(`I2:${LAST_COL}2`);
  const r2 = sheet.getRow(2);
  r2.height = 22;

  const dateCell = sheet.getCell('A2');
  dateCell.value = `📅  Report Date: ${dayLabel}`;
  dateCell.font  = { name: 'Calibri', bold: true, size: 11, color: { argb: C.white } };
  dateCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  dateCell.fill  = solidFill(C.tealDark);

  const genCell = sheet.getCell('I2');
  genCell.value = `⏱  Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}`;
  genCell.font  = { name: 'Calibri', size: 10, italic: true, color: { argb: C.tealLight } };
  genCell.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
  genCell.fill  = solidFill(C.tealDark);

  // ── Row 3: Summary stats bar ─────────────────────────────────────────────
  sheet.mergeCells(`A3:D3`);
  sheet.mergeCells(`E3:H3`);
  sheet.mergeCells(`I3:L3`);
  sheet.mergeCells(`M3:${LAST_COL}3`);
  const r3 = sheet.getRow(3);
  r3.height = 20;

  const totalAlerts = shifts.reduce((sum, s) => {
    const a = s.aiMetadata?.alerts;
    return sum + (a ? a.drowsy + a.sleep + a.phone + a.absence : 0);
  }, 0);

  const statFill = solidFill('FF1E3A5F'); // dark blue accent
  const statFont = (val: string, col: string) => ({
    name: 'Calibri', bold: true, size: 10, color: { argb: col }
  });

  const stats = [
    { cell: 'A3', label: `Shifts Assigned: ${shifts.length}`, color: C.tealLight },
    { cell: 'E3', label: `Morning: ${shifts.filter(s => s.type === 'Morning').length}  ·  Afternoon: ${shifts.filter(s => s.type === 'Afternoon').length}  ·  Night: ${shifts.filter(s => s.type === 'Night').length}`, color: C.tealLight },
    { cell: 'I3', label: `Total Alerts Today: ${totalAlerts}`, color: totalAlerts > 0 ? 'FFFBBF24' : C.tealLight },
    { cell: 'M3', label: `Status: Active Report`, color: 'FF86EFAC' },
  ];

  stats.forEach(({ cell, label, color }) => {
    const c = sheet.getCell(cell);
    c.value = label;
    c.font = statFont(label, color);
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.fill = statFill;
  });

  // ── Row 4: Thin separator ────────────────────────────────────────────────
  sheet.mergeCells(`A4:${LAST_COL}4`);
  const r4 = sheet.getRow(4);
  r4.height = 6;
  sheet.getCell('A4').fill = solidFill(C.tealDark);

  // ── Row 5: Section label ─────────────────────────────────────────────────
  sheet.mergeCells(`A5:${LAST_COL}5`);
  const r5 = sheet.getRow(5);
  r5.height = 20;
  const sectionCell = sheet.getCell('A5');
  sectionCell.value = '  SHIFT ACTIVITY & AI DETECTION METRICS';
  sectionCell.font = { name: 'Calibri', bold: true, size: 10, color: { argb: C.tealLight }, italic: false };
  sectionCell.alignment = { horizontal: 'left', vertical: 'middle' };
  sectionCell.fill = solidFill('FF1E293B'); // slate-800

  // ── Row 6: Column Headers ────────────────────────────────────────────────
  const headerRow = sheet.getRow(6);
  headerRow.height = 24;
  COLUMNS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value  = col.header;
    cell.font   = { name: 'Calibri', bold: true, size: 10, color: { argb: C.white } };
    cell.fill   = solidFill(C.headerBg);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
    cell.border = cellBorders(thickBorder, thinBorder, thickBorder, thinBorder);
  });

  // ── Data Rows ────────────────────────────────────────────────────────────
  if (shifts.length === 0) {
    // Empty state row
    const emptyRow = sheet.getRow(7);
    emptyRow.height = 30;
    sheet.mergeCells(`A7:${LAST_COL}7`);
    const emptyCell = sheet.getCell('A7');
    emptyCell.value = 'No shift data recorded for this date.';
    emptyCell.font = { name: 'Calibri', size: 11, italic: true, color: { argb: C.slate500 } };
    emptyCell.alignment = { horizontal: 'center', vertical: 'middle' };
    emptyCell.fill = solidFill(C.evenRow);
    return;
  }

  shifts.forEach((shift, idx) => {
    const rowNum = 7 + idx;
    const row = sheet.getRow(rowNum);
    row.height = 22;

    const emp = employees.find(e => e.id === shift.employeeId);
    const meta = shift.aiMetadata;
    const { start: schedStart, end: schedEnd } = shiftStartEnd(shift.type);
    const actualStart = meta?.actualStart && meta.actualStart !== '--:--:--' ? meta.actualStart : '—';
    const actualEnd   = meta?.actualEnd   && meta.actualEnd   !== '--:--:--' ? meta.actualEnd   : '—';
    const breakTime   = meta?.breakTime   && meta.breakTime   !== '--:--:--' ? meta.breakTime   : '—';
    const workDur = calcWorkDuration(
      actualStart !== '—' ? actualStart : undefined,
      actualEnd   !== '—' ? actualEnd   : undefined
    );
    const a = meta?.alerts ?? { drowsy: 0, sleep: 0, phone: 0, absence: 0 };
    const totalAlt = a.drowsy + a.sleep + a.phone + a.absence;
    const isEven = idx % 2 === 0;
    const rowFill = solidFill(isEven ? C.evenRow : C.oddRow);

    const cellValues: Record<string, any> = {
      no:          idx + 1,
      name:        emp?.name || `Employee #${shift.employeeId}`,
      department:  emp?.department || '—',
      shift:       shift.type,
      schedStart,
      schedEnd,
      actualStart,
      actualEnd,
      breakTime,
      workDuration:workDur,
      status:      shift.status || 'Scheduled',
      drowsy:      a.drowsy,
      sleep:       a.sleep,
      phone:       a.phone,
      absence:     a.absence,
      totalAlerts: totalAlt,
    };

    COLUMNS.forEach((col, i) => {
      const cell = row.getCell(i + 1);
      cell.value = cellValues[col.key];
      cell.fill  = rowFill;
      cell.border = allThin;
      cell.alignment = { vertical: 'middle', horizontal: i < 2 ? 'left' : 'center' };
      cell.font  = { name: 'Calibri', size: 10, color: { argb: C.black } };

      // Per-column special styling
      if (col.key === 'no') {
        cell.font = { name: 'Calibri', size: 9, color: { argb: C.slate500 } };
      }
      if (col.key === 'name') {
        cell.font = { name: 'Calibri', bold: true, size: 10, color: { argb: C.navyBg } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      }
      if (col.key === 'shift') {
        const shiftColor = shift.type === 'Morning' ? '0E7490' : shift.type === 'Afternoon' ? 'B45309' : '7C3AED';
        cell.font = { name: 'Calibri', bold: true, size: 9, color: { argb: 'FF' + shiftColor } };
        cell.fill = solidFill(
          shift.type === 'Morning'   ? 'FFE0F7FA' :
          shift.type === 'Afternoon' ? 'FFFEF3C7' : 'FFEDE9FE'
        );
      }
      if (col.key === 'status') {
        cell.font = { name: 'Calibri', bold: true, size: 9, color: { argb: statusColor(shift.status) } };
      }
      if (['drowsy', 'sleep', 'phone', 'absence'].includes(col.key)) {
        const count = cellValues[col.key] as number;
        cell.font = { name: 'Calibri', bold: count > 0, size: 10, color: { argb: alertColor(count) } };
      }
      if (col.key === 'totalAlerts') {
        const count = totalAlt;
        cell.font = { name: 'Calibri', bold: true, size: 10, color: { argb: alertColor(count) } };
        if (count > 0) {
          cell.fill = solidFill(count > 5 ? 'FFFEE2E2' : 'FFFEF3C7');
        }
      }
      if (col.key === 'workDuration') {
        cell.font = { name: 'Calibri', bold: workDur !== '—', size: 10, color: { argb: workDur !== '—' ? C.tealDark : C.slate500 } };
      }
    });
  });

  // ── Totals Row ───────────────────────────────────────────────────────────
  const totalsRowNum = 7 + shifts.length;
  const totalsRow = sheet.getRow(totalsRowNum);
  totalsRow.height = 22;

  const sum = (key: 'drowsy' | 'sleep' | 'phone' | 'absence') =>
    shifts.reduce((acc, s) => acc + (s.aiMetadata?.alerts?.[key] ?? 0), 0);

  const totalDrowsy  = sum('drowsy');
  const totalSleep   = sum('sleep');
  const totalPhone   = sum('phone');
  const totalAbsence = sum('absence');
  const grandTotal   = totalDrowsy + totalSleep + totalPhone + totalAbsence;

  const totalsFill = solidFill(C.totalsBg);
  const totalsFont = (argb: string, bold = true) => ({
    name: 'Calibri', bold, size: 10, color: { argb },
  });

  const totalsValues: Partial<Record<typeof COLUMNS[number]['key'], any>> = {
    no:          '',
    name:        'TOTALS',
    department:  '',
    shift:       `${shifts.length} shift(s)`,
    schedStart:  '',
    schedEnd:    '',
    actualStart: '',
    actualEnd:   '',
    breakTime:   '',
    workDuration:'',
    status:      '',
    drowsy:      totalDrowsy,
    sleep:       totalSleep,
    phone:       totalPhone,
    absence:     totalAbsence,
    totalAlerts: grandTotal,
  };

  COLUMNS.forEach((col, i) => {
    const cell = totalsRow.getCell(i + 1);
    cell.value = totalsValues[col.key] ?? '';
    cell.fill  = totalsFill;
    cell.border = cellBorders(thickBorder, thinBorder, thickBorder, thinBorder);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.font = totalsFont(C.tealLight, false);

    if (col.key === 'name') {
      cell.font  = totalsFont(C.tealLight, true);
      cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    }
    if (col.key === 'shift') {
      cell.font = totalsFont('FFFBBF24', false);
    }
    if (['drowsy', 'sleep', 'phone', 'absence', 'totalAlerts'].includes(col.key)) {
      const count = cell.value as number;
      cell.font = totalsFont(count > 0 ? 'FFFBBF24' : C.slate500, count > 0);
    }
  });

  // ── Footer ───────────────────────────────────────────────────────────────
  const footerRowNum = totalsRowNum + 2;
  sheet.mergeCells(`A${footerRowNum}:${LAST_COL}${footerRowNum}`);
  sheet.getRow(footerRowNum).height = 16;
  const footerCell = sheet.getCell(`A${footerRowNum}`);
  footerCell.value = 'Banglalink Network Operations Center  ·  Auto-generated by Banglalink Shift Manager  ·  Confidential';
  footerCell.font = { name: 'Calibri', size: 8, italic: true, color: { argb: C.slate500 } };
  footerCell.alignment = { horizontal: 'center', vertical: 'middle' };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Export one day's shifts as a single-sheet Excel file.
 */
export async function exportDailyReport(
  dateStr: string,
  shifts: Shift[],
  employees: Employee[]
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator  = 'Banglalink Shift Manager';
  wb.created  = new Date();
  wb.modified = new Date();

  const sheetName = format(parseISO(dateStr), 'MMM d, yyyy');
  const sheet = wb.addWorksheet(sheetName, {
    properties: { tabColor: { argb: C.tealDark } },
    pageSetup:  { paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, orientation: 'landscape' },
  });
  sheet.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };

  buildDaySheet(sheet, dateStr, shifts, employees);

  const buffer = await wb.xlsx.writeBuffer();
  triggerDownload(buffer, `NOC_Report_${dateStr}.xlsx`);
}

/**
 * Export all days (array of { dateStr, shifts }) in a multi-sheet workbook.
 */
export async function exportAllReports(
  days: Array<{ dateStr: string; shifts: Shift[] }>,
  employees: Employee[]
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator  = 'Banglalink Shift Manager';
  wb.created  = new Date();
  wb.modified = new Date();

  days.forEach(({ dateStr, shifts }) => {
    const sheetName = format(parseISO(dateStr), 'EEE, MMM d');
    const sheet = wb.addWorksheet(sheetName, {
      properties: { tabColor: { argb: C.tealDark } },
      pageSetup:  { paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, orientation: 'landscape' },
    });
    sheet.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };
    buildDaySheet(sheet, dateStr, shifts, employees);
  });

  // Cover / summary sheet as the first tab
  const coverSheet = wb.addWorksheet('Summary', {
    properties: { tabColor: { argb: C.navyBg } },
    pageSetup:  { paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, orientation: 'landscape' },
  });
  coverSheet.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };
  buildSummarySheet(coverSheet, days, employees);
  // Move summary to front
  (wb as any)._worksheets.unshift((wb as any)._worksheets.pop());

  const dateRange = `${days[days.length - 1]?.dateStr}_to_${days[0]?.dateStr}`;
  const buffer = await wb.xlsx.writeBuffer();
  triggerDownload(buffer, `NOC_Report_${dateRange}.xlsx`);
}

/** Summary sheet: one row per day with totals */
function buildSummarySheet(
  sheet: ExcelJS.Worksheet,
  days: Array<{ dateStr: string; shifts: Shift[] }>,
  employees: Employee[]
) {
  sheet.views = [{ state: 'frozen', ySplit: 5 }];

  // Title
  sheet.mergeCells('A1:I1');
  sheet.getRow(1).height = 38;
  const t = sheet.getCell('A1');
  t.value = 'BANGLALINK NOC — 7-Day Summary Report';
  t.font = { name: 'Calibri', bold: true, size: 18, color: { argb: C.white } };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  t.fill = solidFill(C.navyBg);

  // Period
  sheet.mergeCells('A2:I2');
  sheet.getRow(2).height = 20;
  const period = sheet.getCell('A2');
  const firstDate = days[days.length - 1]?.dateStr ?? '';
  const lastDate  = days[0]?.dateStr ?? '';
  period.value = `Period: ${format(parseISO(firstDate), 'MMM d')} – ${format(parseISO(lastDate), 'MMM d, yyyy')}   ·   Generated: ${format(new Date(), 'yyyy-MM-dd HH:mm')}`;
  period.font  = { name: 'Calibri', size: 11, italic: true, color: { argb: C.tealLight } };
  period.alignment = { horizontal: 'center', vertical: 'middle' };
  period.fill  = solidFill(C.tealDark);

  // Separator
  sheet.mergeCells('A3:I3');
  sheet.getRow(3).height = 6;
  sheet.getCell('A3').fill = solidFill(C.tealDark);

  // Column headers
  const summaryHeaders = ['Date', 'Day', 'Morning', 'Afternoon', 'Night', 'Total Shifts', 'Drowsy', 'Sleeping', 'Mobile', 'Absence', 'Total Alerts'];
  const summaryWidths  = [13, 12, 11, 13, 10, 14, 10, 11, 10, 10, 13];
  summaryHeaders.forEach((h, i) => {
    sheet.getColumn(i + 1).width = summaryWidths[i];
    const cell = sheet.getRow(4).getCell(i + 1);
    cell.value = h;
    cell.font  = { name: 'Calibri', bold: true, size: 10, color: { argb: C.white } };
    cell.fill  = solidFill(C.headerBg);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = cellBorders(thickBorder, thinBorder, thickBorder, thinBorder);
  });
  sheet.getRow(4).height = 24;

  // Data rows
  days.forEach(({ dateStr, shifts }, idx) => {
    const row = sheet.getRow(5 + idx);
    row.height = 20;
    const a = shifts.reduce(
      (acc, s) => {
        const al = s.aiMetadata?.alerts ?? { drowsy: 0, sleep: 0, phone: 0, absence: 0 };
        return {
          drowsy:  acc.drowsy  + al.drowsy,
          sleep:   acc.sleep   + al.sleep,
          phone:   acc.phone   + al.phone,
          absence: acc.absence + al.absence,
        };
      },
      { drowsy: 0, sleep: 0, phone: 0, absence: 0 }
    );
    const totalAlt = a.drowsy + a.sleep + a.phone + a.absence;
    const isEven = idx % 2 === 0;
    const rowFill = solidFill(isEven ? C.evenRow : C.oddRow);

    const vals = [
      dateStr,
      format(parseISO(dateStr), 'EEEE'),
      shifts.filter(s => s.type === 'Morning').length,
      shifts.filter(s => s.type === 'Afternoon').length,
      shifts.filter(s => s.type === 'Night').length,
      shifts.length,
      a.drowsy,
      a.sleep,
      a.phone,
      a.absence,
      totalAlt,
    ];

    vals.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v;
      cell.fill  = rowFill;
      cell.border = allThin;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.font  = { name: 'Calibri', size: 10, color: { argb: C.black } };
      if (i >= 6) {
        const count = v as number;
        cell.font = { name: 'Calibri', bold: count > 0, size: 10, color: { argb: alertColor(count) } };
      }
      if (i === 10 && (v as number) > 0) {
        cell.fill = solidFill((v as number) > 10 ? 'FFFEE2E2' : 'FFFEF3C7');
      }
    });
  });
}

/** Trigger a file download in the browser */
function triggerDownload(buffer: ArrayBuffer | Buffer, filename: string) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
