# Banglalink Shift Manager - Technical Documentation

## Project Overview
**Banglalink Shift Manager** is an enterprise-grade NOC (Network Operations Center) dashboard designed for monitoring operator shifts, real-time AI-driven alerts, and employee performance. The system integrates scheduling with actual activity metadata captured by an AI recognition engine.

## Core Features

### 1. Dashboard (System Overview)
- **Real-time Stats**: High-level metrics for Total Employees, Active Shifts, Alerts Today, and Critical Alerts.
- **Visual Analytics**: 
    - **Alert Trends (24h)**: Line chart showing alert frequency over time.
    - **Alert Distribution**: Pie chart categorizing AI-detected behaviors (Drowsiness, Sleeping, Mobile Usage, Absence).
- **Recent Logs**: A live table of the latest system alerts with severity badges.

### 2. Shift Planner
- **Calendar Interface**: A full-month grid view for managers to assign shifts.
- **Assignment Modal**: 
    - Select employee from a searchable list.
    - Choose shift type (Morning, Day, Night).
    - Automatic conflict detection (mocked).
- **Feedback**: "Added successfully" toast notifications upon assignment.

### 3. Shift Viewer (7-Day Outlook)
- **Side-by-Side View**: Displays the next 7 days of shifts.
- **Shift Boxes**: Each date has three distinct boxes (Morning, Day, Night) showing assigned employees side-by-side.
- **Quick Scannability**: Designed for operators to check their upcoming schedules at a glance.

### 4. Employee Directory
- **Management Table**: Searchable list of all employees with status indicators (Active, On Break, Off Duty).
- **Profile Details**: View detailed contact info, role, and access levels.
- **Report Generation**: A dedicated "Generate Report" button for each employee that allows selecting a date range to download activity summaries.

### 5. AI Activity Reports
- **AI Metadata Integration**: 
    - **Face Recognition**: Start time is recorded when the AI engine recognizes the operator's face.
    - **Shift Timings**: Tracks Start, End, and total Break times.
- **AI Detection Alerts**: Detailed counts for:
    - **Drowsiness Detection**
    - **Sleep Detection**
    - **Mobile Phone Usage Detection**
    - **Absence from Desk Detection**
- **Historical View**: Scrollable list of the past 7 days showing detailed metadata for every shift assigned.

## Technical Stack
- **Framework**: React 18+ with TypeScript.
- **Styling**: Tailwind CSS (Utility-first, dark theme).
- **Icons**: Lucide-react.
- **Animations**: Motion (motion/react).
- **Charts**: Recharts (Responsive SVG charts).
- **Date Utilities**: date-fns.

## Data Architecture

### Shift Interface (`src/types.ts`)
```typescript
export interface Shift {
  id: string;
  employeeId: string;
  date: string; // YYYY-MM-DD
  type: 'Morning Shift' | 'Day Shift' | 'Night Shift';
  aiMetadata?: {
    startTime?: string;
    endTime?: string;
    breakTime?: string;
    alerts: {
      drowsiness: number;
      sleeping: number;
      mobileUsage: number;
      absence: number;
    };
  };
}
```

### File Structure
- `/src/pages/`:
    - `Dashboard.tsx`: Main analytics hub.
    - `ShiftPlanner.tsx`: Scheduling interface.
    - `ShiftViewer.tsx`: 7-day side-by-side schedule view.
    - `Employees.tsx`: Staff management and report triggers.
    - `Reports.tsx`: Detailed AI metadata logs.
- `/src/components/`:
    - `Sidebar.tsx`: Collapsible navigation with branding.
    - `Modal.tsx`: Reusable accessible dialog component.
    - `StatCard.tsx`: Standardized metric display cards.
    - `Badge.tsx`: Status and severity indicators.
- `/src/data/mockData.ts`: Central source of truth for initial state and mock entities.

## Future Modification Guidelines (Antigravity)
1. **Adding New AI Alerts**: Update the `Shift` interface in `types.ts`, then update the `Reports.tsx` grid and `mockData.ts` generators.
2. **Real Database Integration**: Replace `MOCK_SHIFTS` state in `ShiftPlanner.tsx` with API calls. The `aiMetadata` should be fetched from the backend database where the AI engine stores its recognition results.
3. **Export Logic**: The "Generate Report" and "Export" buttons currently trigger alerts/placeholders. Use libraries like `jspdf` or `xlsx` to implement actual file generation.
