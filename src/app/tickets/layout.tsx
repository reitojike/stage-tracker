import type { ReactNode } from 'react';
import { AppShell } from '@/ui/AppShell';
import { resolveMyPageAppBarIdentity } from '@/infrastructure/supabase/session.ts';

/**
 * Wraps every route under this segment - including its own loading.tsx - in
 * the shared screen shell, so the app bar and primary navigation stay on
 * screen while a server navigation is in flight (mirrors
 * src/app/calendar/layout.tsx for Issue #144).
 */
export default async function TicketsSectionLayout({ children }: { children: ReactNode }) {
  const identity = await resolveMyPageAppBarIdentity();
  return <AppShell {...identity}>{children}</AppShell>;
}
