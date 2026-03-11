export interface Employee {
  id: string;
  name: string;
  department: string;
  active: boolean;
}

export interface Alert {
  id: string;
  timestamp: string;
  type: 'Critical' | 'Warning' | 'Info';
  category?: string;
  message: string;
  source: string;
}

export interface Shift {
  id: string;
  employeeId: string;
  date: string; // YYYY-MM-DD
  type: 'Morning' | 'Afternoon' | 'Night';
  startTime?: string;
  endTime?: string;
  status?: string;
  aiMetadata?: {
    actualStart?: string;
    actualEnd?: string;
    breakTime?: string;
    alerts: {
      drowsy: number;
      sleep: number;
      phone: number;
      absence: number;
    };
  };
}
