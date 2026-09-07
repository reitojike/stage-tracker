import Link from 'next/link';
import type { ReactNode } from 'react';
import { LinkPending } from './LinkPending';
import styles from './BackLink.module.css';

export interface BackLinkProps {
  href: string;
  children: ReactNode;
}

/**
 * The contextual "back to where this screen was opened from" affordance.
 * Distinct from PrimaryNav: the caller decides what "back" means here
 * (which month, which list), while PrimaryNav always offers the same
 * fixed destinations. Gate A must be navigable without the browser's own
 * back button (#70), so both exist rather than either alone.
 */
export function BackLink({ href, children }: BackLinkProps) {
  return (
    <Link href={href} className={styles.backLink}>
      <span aria-hidden="true">←</span>
      <span>{children}</span>
      <LinkPending />
    </Link>
  );
}
