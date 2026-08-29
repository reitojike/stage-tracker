'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType } from 'react';
import { LinkPending } from './LinkPending';
import styles from './PrimaryNav.module.css';

interface NavIconProps {
  className?: string;
}

/**
 * Shared icon shell: 24x24 viewBox / stroke=currentColor (Issue #188), so
 * every destination icon inherits the link's current/inactive text color
 * without a separate icon color token. `aria-hidden` + `focusable="false"`
 * keep these purely decorative - the visible text label stays the sole
 * accessible name source (see ITEMS below).
 */
function NavIconShell({ className, children }: NavIconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width="21"
      height="21"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

function HomeIcon(props: NavIconProps) {
  return (
    <NavIconShell {...props}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6.5 10v8.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10" />
    </NavIconShell>
  );
}

/**
 * Base calendar glyph shared by イベント and マイカレンダー (design handoff:
 * "同じカレンダーなので、チェックの有無で区別する"). CalendarCheckIcon below
 * composes this shape rather than duplicating the grid/ring paths.
 */
function CalendarGlyph() {
  return (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 9.5h16" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </>
  );
}

function CalendarIcon(props: NavIconProps) {
  return (
    <NavIconShell {...props}>
      <CalendarGlyph />
    </NavIconShell>
  );
}

function CalendarCheckIcon(props: NavIconProps) {
  return (
    <NavIconShell {...props}>
      <CalendarGlyph />
      <path d="M8.5 14.7 10.6 16.8 15.5 12.3" />
    </NavIconShell>
  );
}

function TicketIcon(props: NavIconProps) {
  return (
    <NavIconShell {...props}>
      <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.5a2.5 2.5 0 0 0 0 5V16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.5a2.5 2.5 0 0 0 0-5V8Z" />
      <path d="M12 6.5v2M12 11v2M12 15.5v2" />
    </NavIconShell>
  );
}

interface PrimaryNavItem {
  href: string;
  label: string;
  Icon: ComponentType<NavIconProps>;
}

/**
 * The four-item bottom nav confirmed by the design refresh (Issue #140,
 * design_handoff_stage_tracker/README.md "共通: bottom nav"). Supersedes the
 * prior Gate A three-item set (#70 "Bounded IA decision") by adding チケット.
 * My Page and お知らせ are deliberately not nav peers - they open from the
 * AppBar (avatar / bell) instead, per the same handoff section.
 *
 * Labels repeat each destination's own page heading verbatim, so arriving
 * on a screen confirms which nav item was tapped. Icons (Issue #188) are a
 * secondary scan aid alongside the label, not a replacement for it.
 */
const ITEMS: readonly PrimaryNavItem[] = [
  { href: '/', label: 'ホーム', Icon: HomeIcon },
  { href: '/catalog', label: 'イベント', Icon: CalendarIcon },
  { href: '/tickets', label: 'チケット', Icon: TicketIcon },
  { href: '/calendar', label: 'マイカレンダー', Icon: CalendarCheckIcon },
];

/**
 * Home matches only exactly: every other route is nested under some
 * destination, so a prefix match on '/' would mark Home current
 * everywhere. `/schedule` intentionally matches no item - it is a
 * secondary path, not a primary destination.
 */
function isCurrent(pathname: string, href: string): boolean {
  if (href === '/') {
    return pathname === '/';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PrimaryNav() {
  const pathname = usePathname();

  return (
    <nav className={styles.nav} aria-label="主要ナビゲーション">
      <ul className={styles.items}>
        {ITEMS.map((item) => {
          const current = isCurrent(pathname, item.href);
          return (
            <li key={item.href} className={styles.item}>
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={[styles.link, current ? styles.linkCurrent : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                <item.Icon className={styles.icon} />
                <span className={styles.label}>{item.label}</span>
                <LinkPending label={`${item.label}へ移動中`} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
