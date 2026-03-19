'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Shift } from '../types';
import {
  MOCK_EMPLOYEES,
  MOCK_SHIFTS,
  MOCK_ALERTS,
  MOCK_DASHBOARD_STATS,
  MOCK_TREND_DATA,
  MOCK_DISTRIBUTION_DATA,
} from '../data/mockData';

// ── Health check ─────────────────────────────────────────────────────────────

async function pingBackend(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch('/api/auth/me', { signal: controller.signal });
    clearTimeout(timer);
    // Any HTTP response (even 401) means the backend is running
    return res.status !== 0;
  } catch {
    return false;
  }
}

// ── Context types ─────────────────────────────────────────────────────────────

interface GuestContextType {
  isGuest: boolean;
  backendOnline: boolean | null; // null = still checking
  loginAsGuest: () => void;
  exitGuest: () => void;

  // Read data (from mock + in-memory mutations)
  guestEmployees: typeof MOCK_EMPLOYEES;
  guestShifts: Shift[];
  guestAlerts: typeof MOCK_ALERTS;
  guestDashboardStats: typeof MOCK_DASHBOARD_STATS;
  guestTrendData: typeof MOCK_TREND_DATA;
  guestDistributionData: typeof MOCK_DISTRIBUTION_DATA;

  // Shift mutations (stored in session memory only)
  addGuestShift: (shift: Shift) => void;
  updateGuestShift: (id: string, updates: Partial<Shift>) => void;
  removeGuestShift: (id: string) => void;
}

const GuestContext = createContext<GuestContextType | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function GuestProvider({ children }: { children: ReactNode }) {
  const [isGuest, setIsGuest] = useState(false);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);

  // In-memory shift store — seeded from mock data, destroyed on page reload
  const [guestShifts, setGuestShifts] = useState<Shift[]>(MOCK_SHIFTS);

  // Health check on mount
  useEffect(() => {
    pingBackend().then(online => setBackendOnline(online));
  }, []);

  const loginAsGuest = useCallback(() => setIsGuest(true), []);
  const exitGuest    = useCallback(() => setIsGuest(false), []);

  const addGuestShift = useCallback((shift: Shift) => {
    setGuestShifts(prev => [...prev, shift]);
  }, []);

  const updateGuestShift = useCallback((id: string, updates: Partial<Shift>) => {
    setGuestShifts(prev =>
      prev.map(s => (s.id === id ? { ...s, ...updates } : s))
    );
  }, []);

  const removeGuestShift = useCallback((id: string) => {
    setGuestShifts(prev => prev.filter(s => s.id !== id));
  }, []);

  return (
    <GuestContext.Provider
      value={{
        isGuest,
        backendOnline,
        loginAsGuest,
        exitGuest,
        guestEmployees: MOCK_EMPLOYEES,
        guestShifts,
        guestAlerts: MOCK_ALERTS,
        guestDashboardStats: MOCK_DASHBOARD_STATS,
        guestTrendData: MOCK_TREND_DATA,
        guestDistributionData: MOCK_DISTRIBUTION_DATA,
        addGuestShift,
        updateGuestShift,
        removeGuestShift,
      }}
    >
      {children}
    </GuestContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useGuest() {
  const ctx = useContext(GuestContext);
  if (!ctx) throw new Error('useGuest must be used within GuestProvider');
  return ctx;
}
