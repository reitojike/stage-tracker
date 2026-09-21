import Link from 'next/link';
import { Bell } from 'lucide-react';
import { cn } from './lib/utils';

export type AppBarProps = {
  /**
   * Hides both affordances (notification bell + My Page avatar) on
   * unauthenticated surfaces. Default `true`.
   */
  showActions?: boolean;
  /**
   * Display-only latch: whether to show the unread dot. The shared shell
   * convention is documented in `docs/ux-ui.md`; unread-state derivation is
   * runtime/data wiring and is not performed by AppBar.
   */
  hasUnreadNotifications?: boolean;
  /** Href for the authenticated Notifications inbox affordance. */
  notificationsHref?: string;
  /** Href for the My Page avatar affordance (top-right). */
  myPageHref: string;
  /** Single-character (or short) initial shown inside the avatar chip. */
  myPageInitial: string;
  className?: string;
};

/**
 * 48px fixed header: notification bell (left) / logotype (center) / My Page
 * avatar (right). Exact header sizing and presentation are owned by this
 * runtime component. It is purely presentational - no Supabase/data dependency.
 */
export function AppBar({
  showActions = true,
  hasUnreadNotifications = false,
  notificationsHref = '/notifications',
  myPageHref,
  myPageInitial,
  className,
}: AppBarProps) {
  return (
    <header
      data-slot="app-bar"
      className={cn(
        'flex h-12 shrink-0 items-center justify-between border-b border-border bg-background px-md',
        className,
      )}
    >
      {showActions ? (
        <Link
          href={notificationsHref}
          aria-label={hasUnreadNotifications ? 'お知らせ（未読あり）' : 'お知らせ'}
          className="relative inline-flex size-11 touch-manipulation items-center justify-center rounded-control-sm text-foreground hover:bg-muted active:bg-surface-active focus-visible:outline-none focus-visible:ring-(length:--focus-ring-width) focus-visible:ring-ring/50"
        >
          <Bell aria-hidden className="size-5" />
          {hasUnreadNotifications ? (
            <span
              aria-hidden
              data-slot="notification-unread-indicator"
              className="absolute top-2 right-2 size-2 rounded-pill bg-primary"
            />
          ) : null}
        </Link>
      ) : (
        <span aria-hidden className="size-11" />
      )}

      <span className="text-label font-semibold tracking-widest text-foreground">
        STAGE TRACKER
      </span>

      {showActions ? (
        <Link
          href={myPageHref}
          aria-label="マイページ"
          className="inline-flex size-11 touch-manipulation items-center justify-center rounded-pill border border-border bg-background text-label font-semibold text-foreground hover:bg-muted"
        >
          {myPageInitial}
        </Link>
      ) : (
        <span aria-hidden className="size-11" />
      )}
    </header>
  );
}
