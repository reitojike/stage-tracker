import type { ReactNode } from 'react';
import { AppBar } from './AppBar';
import { PrimaryNav } from './PrimaryNav';
import styles from './AppShell.module.css';

export interface AppShellProps {
  children: ReactNode;
  /**
   * Off for surfaces reached before a session exists (`/sign-in`). Every
   * primary destination sits behind the default-deny auth boundary
   * (src/proxy.ts), so offering them there would only produce redirects.
   * Also gates the AppBar's notification/My Page affordances (Issue #141):
   * both are authenticated-only destinations, same as the nav items.
   */
  showPrimaryNav?: boolean;
  /**
   * My Page avatar destination (Issue #159), forwarded to AppBar as-is.
   * Left unset wherever there is no session to back it (`/sign-in`).
   */
  myPageHref?: string;
  /**
   * My Page avatar initial, forwarded to AppBar as-is. Resolving the
   * signed-in identity is each segment's own `layout.tsx`'s job, same as
   * before (#141 boundary) - AppShell stays a plain presentational
   * component with no Supabase/session dependency of its own, so it keeps
   * rendering the same way in Storybook without a real request context.
   */
  myPageInitial?: string;
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
 *
 * The notification bell stays unwired here (Issue #141 boundary, still
 * true post-#159): there is no canonical unread-notification source and
 * `/notifications` doesn't exist yet (#148's remaining Notifications
 * lane). The My Page avatar is wired by each caller via `myPageHref` /
 * `myPageInitial` (Issue #159).
 */
export function AppShell({
  children,
  showPrimaryNav = true,
  myPageHref,
  myPageInitial,
}: AppShellProps) {
  return (
    <div className={styles.shell}>
      <AppBar showActions={showPrimaryNav} myPageHref={myPageHref} myPageInitial={myPageInitial} />

      <main className={styles.content}>{children}</main>

      {showPrimaryNav ? <PrimaryNav /> : null}
    </div>
  );
}
