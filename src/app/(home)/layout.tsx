import type { ReactNode } from 'react';
import { AppShell } from '@/ui/AppShell';

/**
 * Home gets its own segment layout, in a route group so the URL stays `/`.
 * Rendering AppShell from the page itself would have left Home the one
 * primary destination whose shell disappears while the page is resolving -
 * every other segment keeps the app bar and primary navigation on screen
 * across its own loading.tsx.
 */
export default function HomeSectionLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
