import type { ReactNode } from "react";
import { AppBar, type AppBarProps } from "./app-bar";
import { PrimaryNav } from "./primary-nav";
import { cn } from "@/lib/utils";

export type AppShellProps = Pick<
  AppBarProps,
  | "showActions"
  | "hasUnreadNotifications"
  | "onNotificationsPress"
  | "myPageHref"
  | "myPageInitial"
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
      className={cn("flex min-h-full flex-1 flex-col bg-background", className)}
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
          fixedSubmitBar.module.css). */}
      <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-section px-md py-lg">
        {children}
      </div>
      {showPrimaryNav ? <PrimaryNav /> : null}
    </div>
  );
}
