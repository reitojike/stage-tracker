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
   * Display-only latch: whether to show the unread dot. AppBar never
   * derives this itself (docs/v2/oracle-routes-ui.md §3 AppBar).
   */
  hasUnreadNotifications?: boolean;
  /**
   * Notifications (お知らせ) are not implemented yet - PO decision P1
   * (docs/v2/decisions.md) keeps the bell in the UI but non-interactive
   * until that feature ships. When `onNotificationsPress` is omitted, the
   * bell renders `aria-disabled` and does not respond to clicks, matching
   * the current (pre-P1-implementation) product behavior. Once the
   * notifications feature is implemented, pass a real handler here to
   * enable it - no other change to AppBar's API should be needed.
   */
  onNotificationsPress?: (() => void) | undefined;
  /** Href for the My Page avatar affordance (top-right). */
  myPageHref: string;
  /** Single-character (or short) initial shown inside the avatar chip. */
  myPageInitial: string;
  className?: string;
};

/**
 * 48px fixed header: notification bell (left) / logotype (center) / My Page
 * avatar (right). Purely presentational - no Supabase/data dependency
 * (docs/v2/oracle-routes-ui.md §3 AppBar).
 */
export function AppBar({
  showActions = true,
  hasUnreadNotifications = false,
  onNotificationsPress,
  myPageHref,
  myPageInitial,
  className,
}: AppBarProps) {
  const notificationsEnabled = showActions && typeof onNotificationsPress === 'function';

  return (
    <header
      data-slot="app-bar"
      className={cn(
        'flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-md',
        className,
      )}
    >
      {showActions ? (
        <button
          type="button"
          aria-label={hasUnreadNotifications ? 'お知らせ（未読あり）' : 'お知らせ'}
          aria-disabled={notificationsEnabled ? undefined : true}
          onClick={notificationsEnabled ? onNotificationsPress : undefined}
          className={cn(
            'relative inline-flex size-10 items-center justify-center rounded-control-sm text-foreground',
            notificationsEnabled
              ? 'hover:bg-muted active:bg-surface-active'
              : 'cursor-not-allowed opacity-(--opacity-disabled)',
          )}
        >
          <Bell aria-hidden className="size-5" />
          {hasUnreadNotifications ? (
            <span
              aria-hidden
              className="absolute top-2 right-2 size-2 rounded-pill bg-destructive"
            />
          ) : null}
        </button>
      ) : (
        <span aria-hidden className="size-10" />
      )}

      <span className="text-label font-semibold tracking-wide text-foreground">stage-tracker</span>

      {showActions ? (
        <Link
          href={myPageHref}
          aria-label="マイページ"
          className="inline-flex size-10 items-center justify-center rounded-pill bg-muted text-label font-semibold text-foreground hover:bg-surface-active"
        >
          {myPageInitial}
        </Link>
      ) : (
        <span aria-hidden className="size-10" />
      )}
    </header>
  );
}
