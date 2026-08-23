import type { ReactNode } from 'react';
import { PrimaryNav } from './PrimaryNav';
import styles from './AppShell.module.css';

export interface AppShellProps {
  children: ReactNode;
  /**
   * Off for surfaces reached before a session exists (`/sign-in`). Every
   * primary destination sits behind the default-deny auth boundary
   * (src/proxy.ts), so offering them there would only produce redirects.
   */
  showPrimaryNav?: boolean;
}

/**
 * The one screen shell every Gate A surface renders inside: app bar, a
 * single bounded content column, and the primary navigation.
 *
 * It owns the page's `<main>` and the vertical rhythm between top-level
 * blocks, so an individual page contributes content rather than layout.
 * Before #70 each page was an unstyled `<main>` whose children fell back
 * to UA defaults with no bounded width and no consistent spacing, which is
 * what made the smartphone screens read as a raw prototype instead of one
 * product (#69 observations).
 *
 * Applied through a per-section `layout.tsx` rather than the root layout,
 * so the shell stays on screen across a segment's own `loading.tsx` and so
 * `/sign-in` can opt out of the nav.
 */
export function AppShell({ children, showPrimaryNav = true }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <header className={styles.appBar}>
        <p className={styles.brand}>stage-tracker</p>
      </header>

      <main className={styles.content}>{children}</main>

      {showPrimaryNav ? <PrimaryNav /> : null}
    </div>
  );
}
