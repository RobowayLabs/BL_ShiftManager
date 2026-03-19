'use client';

import { AuthProvider } from '@/src/context/AuthContext';
import { GuestProvider } from '@/src/context/GuestContext';
import { NotificationProvider } from '@/src/context/NotificationContext';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <GuestProvider>
      <AuthProvider>
        <NotificationProvider>
          {children}
        </NotificationProvider>
      </AuthProvider>
    </GuestProvider>
  );
}
