'use client';

import { AuthProvider } from '@/src/context/AuthContext';
import { GuestProvider } from '@/src/context/GuestContext';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <GuestProvider>
      <AuthProvider>{children}</AuthProvider>
    </GuestProvider>
  );
}
