import type { ReactNode } from 'react';
import styles from './ActionRow.module.css';

export interface ActionRowProps {
  children: ReactNode;
}

/**
 * Groups a screen's action controls (LinkButton / Button) into one row so
 * they keep their natural width instead of each being stretched across the
 * shell's content column, and wraps to the next line when they no longer
 * fit a narrow viewport.
 */
export function ActionRow({ children }: ActionRowProps) {
  return <div className={styles.row}>{children}</div>;
}
