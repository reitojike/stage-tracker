'use client';

import { Button } from './Button';
import { LinkButton } from './LinkButton';
import styles from './AppBar.module.css';

export interface AppBarProps {
  /**
   * Off for surfaces reached before a session exists (e.g. `/sign-in`).
   * The notification bell and My Page avatar are both authenticated-only
   * affordances - showing them where there is no session to back them
   * would be misleading even though they're currently inert either way.
   */
  showActions?: boolean;
  /**
   * Left affordance's unread dot. Purely a presentation capability - this
   * component never derives it from any data source. Notification
   * persistence/read-state is a separate, not-yet-decided product
   * checkpoint (parent Issue #136's Notifications lane); until a caller
   * has a real canonical source, omit this rather than pass a guessed
   * value.
   */
  hasUnreadNotifications?: boolean;
  /**
   * Left affordance's press handler. `/notifications` doesn't exist yet
   * (#148 owns that screen), so leaving this unset renders the button as
   * an inert, correctly-sized tap target instead of a dead link.
   */
  onNotificationsPress?: () => void;
  /**
   * Right affordance's destination (Issue #159: `/mypage` now exists).
   * Rendered as a real link via LinkButton rather than a client-side
   * push, matching PrimaryNav/HomeNav's own navigation. Left unset keeps
   * the avatar an inert, correctly-sized tap target instead of a dead
   * link - used only where a caller has no destination to hand it yet.
   */
  myPageHref?: string;
  /**
   * Initial shown inside the avatar circle. No identity lookup happens in
   * this component - the caller supplies it once it has one to show.
   */
  myPageInitial?: string;
}

/**
 * Shared app bar (Issue #141): 48px, left notification affordance,
 * centered `STAGE TRACKER` logotype, right My Page avatar affordance.
 * Rendered once from AppShell so every authenticated screen shares the
 * same instance rather than each screen composing its own header.
 */
export function AppBar({
  showActions = true,
  hasUnreadNotifications = false,
  onNotificationsPress,
  myPageHref,
  myPageInitial,
}: AppBarProps) {
  const avatar = (
    <span className={styles.avatar} aria-hidden="true">
      {myPageInitial ?? ''}
    </span>
  );
  const myPage = !showActions ? (
    <span aria-hidden="true" />
  ) : myPageHref ? (
    <LinkButton href={myPageHref} variant="icon" className={styles.myPage} aria-label="マイページ">
      {avatar}
    </LinkButton>
  ) : (
    <Button variant="icon" className={styles.myPage} aria-label="マイページ" aria-disabled={true}>
      {avatar}
    </Button>
  );

  return (
    <header className={styles.appBar}>
      {showActions ? (
        <Button
          variant="icon"
          className={styles.notifications}
          aria-label={hasUnreadNotifications ? 'お知らせ（未読あり）' : 'お知らせ'}
          aria-disabled={onNotificationsPress ? undefined : true}
          onClick={onNotificationsPress}
        >
          <span className={styles.bellIcon}>
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 8a5 5 0 0 1 10 0c0 3.2 1 4.6 1.6 5.3a.6.6 0 0 1-.45 1H3.85a.6.6 0 0 1-.45-1C4 12.6 5 11.2 5 8Z" />
              <path d="M8.2 16.3a1.9 1.9 0 0 0 3.6 0" />
            </svg>
            {hasUnreadNotifications ? (
              <span aria-hidden="true" className={styles.unreadDot} />
            ) : null}
          </span>
        </Button>
      ) : (
        <span aria-hidden="true" />
      )}

      <p className={styles.brand}>STAGE TRACKER</p>

      {myPage}
    </header>
  );
}
