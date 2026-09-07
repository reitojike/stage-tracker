import type { ReactNode } from 'react';
import { AppShell } from '@/ui/AppShell';
import { resolveMyPageAppBarIdentity } from '@/infrastructure/supabase/session.ts';

/**
 * Wraps every route under this segment - including its own loading.tsx -
 * in the shared screen shell, so the app bar and primary navigation stay
 * on screen while a server navigation is in flight (#70). My Page is
 * reached from the AppBar avatar, not a PrimaryNav item (Issue #159) - see
 * PrimaryNav.tsx's own comment on `/schedule` for why a secondary
 * destination matching no nav item is expected, not a bug.
 */
export default async function MyPageSectionLayout({ children }: { children: ReactNode }) {
  const identity = await resolveMyPageAppBarIdentity();
  return <AppShell {...identity}>{children}</AppShell>;
}
