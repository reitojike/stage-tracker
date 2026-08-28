import type { ReactNode } from 'react';
import styles from './StatePanel.module.css';

export type StatePanelVariant = 'empty' | 'error' | 'unavailable';

export interface StatePanelProps {
  variant: StatePanelVariant;
  title: string;
  description?: string;
  action?: ReactNode;
}

/**
 * Common state presentation primitive. `variant`とmessageの意味づけは
 * feature/domain層が所有し、このcomponentはpresentationのみを持つ
 * (docs/ux-ui.md「Common states」参照)。
 *
 * empty/error/unavailableはtitle -> description -> actionという同一の
 * structural compositionと上下hairlineを共有する。違いはcopy（とrole）
 * だけで表現し、赤やwarning iconでerrorを特別扱いしない
 * (Issue #187: 赤は期限専用のtokenのため)。
 */
export function StatePanel({ variant, title, description, action }: StatePanelProps) {
  return (
    <div
      className={styles.panel}
      data-variant={variant}
      role={variant === 'error' ? 'alert' : 'status'}
    >
      <p className={styles.title}>{title}</p>
      {description ? <p className={styles.description}>{description}</p> : null}
      {action}
    </div>
  );
}
