import type { ReactNode } from 'react';
import { AppShell } from '@/ui/AppShell';

/**
 * Sign-in renders in the same shell as the rest of the app, but without
 * the primary navigation: every destination it would offer sits behind the
 * default-deny auth boundary (src/proxy.ts), so the links would only
 * redirect straight back here.
 */
export default function SignInLayout({ children }: { children: ReactNode }) {
  return <AppShell showPrimaryNav={false}>{children}</AppShell>;
}
