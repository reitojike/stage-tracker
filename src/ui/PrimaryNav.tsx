'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LinkPending } from './LinkPending';
import styles from './PrimaryNav.module.css';

interface PrimaryNavItem {
  href: string;
  label: string;
}

/**
 * Gate A's bounded primary destinations (#70 "Bounded IA decision"):
 * Event Catalog is the shared catalog, My Calendar is the caller's own
 * participation plus event-independent personal schedule. Personal
 * Schedule management is deliberately *not* a peer here - it stays
 * reachable as a secondary path from Home and from My Calendar, so it no
 * longer sits beside My Calendar as an identical-looking top-level
 * destination whose different meaning nothing explains.
 *
 * Labels repeat each destination's own page heading verbatim, so arriving
 * on a screen confirms which nav item was tapped.
 *
 * This is not the final IA. The current Gate A label set is materialised in
 * docs/ux-ui.md as ホーム / イベント / マイカレンダー, while the bottom-nav
 * item count, Search tab, Settings placement, and future feature navigation
 * remain intentionally unresolved. This component materialises only what the
 * current Gate A journeys need.
 */
const ITEMS: readonly PrimaryNavItem[] = [
  { href: '/', label: 'ホーム' },
  { href: '/catalog', label: 'イベント' },
  { href: '/calendar', label: 'マイカレンダー' },
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
