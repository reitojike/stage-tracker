import type { ReactNode } from 'react';
import { AppBar, type AppBarProps } from './app-bar';
import { PrimaryNav } from './primary-nav';
import { cn } from './lib/utils';

export type AppShellProps = Pick<
  AppBarProps,
  'showActions' | 'hasUnreadNotifications' | 'onNotificationsPress' | 'myPageHref' | 'myPageInitial'
> & {
  children: ReactNode;
  /** Hides the bottom PrimaryNav on unauthenticated surfaces. Default `true`. */
  showPrimaryNav?: boolean;
  className?: string;
};

/**
 * The all-screen shell: AppBar + bounded content column + PrimaryNav
 * (docs/v2/oracle-routes-ui.md §3 AppShell). Purely presentational - no
 * Supabase dependency. Every authenticated route's `layout.tsx` renders
 * this and nothing else (oracle §0), passing through the identity resolved
 * server-side (`myPageHref`/`myPageInitial`).
 *
 * `showPrimaryNav`/`showActions` exist so an unauthenticated-but-still-
 * inside-the-shell surface can hide both navigation affordances rather than
 * a caller having to reimplement the shell's chrome; ordinary authenticated
 * routes leave both at their default (`true`).
 */
export function AppShell({
  children,
  showPrimaryNav = true,
  showActions = true,
  hasUnreadNotifications = false,
  onNotificationsPress,
  myPageHref,
  myPageInitial,
  className,
}: AppShellProps) {
  return (
    <div
      data-slot="app-shell"
      className={cn('flex min-h-full flex-1 flex-col bg-background', className)}
    >
      <AppBar
        showActions={showActions}
        hasUnreadNotifications={hasUnreadNotifications}
        onNotificationsPress={onNotificationsPress}
        myPageHref={myPageHref}
        myPageInitial={myPageInitial}
      />
      {/* Bounded content column: 640px matches the legacy fixed-width
          content contract (docs/v2/oracle-routes-ui.md §3
          fixedSubmitBar.module.css). `<main>` (not `<div>`) matches
          apps/legacy-web/src/ui/AppShell.tsx, which owns the page's single
          `<main>` landmark here - lost in the initial v2 port and caught by
          an axe-core run against the AppShell stories (PR #377 review,
          Issue #376 a11y verification): without it, axe flags both
          `landmark-one-main` and `region` (page content not contained by
          any landmark). Individual route pages still own their own `<h1>`
          inside `{children}`, same division of responsibility as legacy. */}
      <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-section px-md py-lg">
        {children}
      </main>
      {showPrimaryNav ? <PrimaryNav /> : null}
    </div>
  );
}
