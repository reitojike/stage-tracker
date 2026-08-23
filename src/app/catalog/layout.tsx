import type { ReactNode } from 'react';
import { AppShell } from '@/ui/AppShell';

/**
 * Wraps every route under this segment - including its own loading.tsx -
 * in the shared screen shell, so the app bar and primary navigation stay
 * on screen while a server navigation is in flight (#70).
 */
export default function CatalogSectionLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
