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
 */
export function StatePanel({ variant, title, description, action }: StatePanelProps) {
  const classes = [styles.panel, styles[variant]].join(' ');

  return (
    <div className={classes} role={variant === 'error' ? 'alert' : 'status'}>
      <p className={styles.title}>{title}</p>
      {description ? <p className={styles.description}>{description}</p> : null}
      {action}
    </div>
  );
}
