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
 * The four-item bottom nav confirmed by the design refresh (Issue #140,
 * design_handoff_stage_tracker/README.md "共通: bottom nav"). Supersedes the
 * prior Gate A three-item set (#70 "Bounded IA decision") by adding チケット.
 * My Page and お知らせ are deliberately not nav peers - they open from the
 * AppBar (avatar / bell) instead, per the same handoff section.
 *
 * Labels repeat each destination's own page heading verbatim, so arriving
 * on a screen confirms which nav item was tapped.
 */
const ITEMS: readonly PrimaryNavItem[] = [
  { href: '/', label: 'ホーム' },
  { href: '/catalog', label: 'イベント' },
  { href: '/tickets', label: 'チケット' },
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
