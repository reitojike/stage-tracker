import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Badge.module.css';

/**
 * Issue #138: Badge is redefined to 4 shape-based variants instead of
 * success/warning/danger/info/neutral color states. Each variant conveys a
 * fixed meaning regardless of color:
 * - outline: classification (e.g. 宝塚/月組, 一般発売)
 * - subtle: in-progress/current state (e.g. 申込中, 参加する)
 * - deadline: a deadline that can still be acted on
 * - terminal: ended, no action possible (e.g. 落選, 中止)
 */
export type BadgeVariant = 'outline' | 'subtle' | 'deadline' | 'terminal';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  icon?: ReactNode;
}

const VARIANT_CLASS: Record<BadgeVariant, keyof typeof styles> = {
  outline: 'outline',
  subtle: 'subtle',
  deadline: 'deadline',
  terminal: 'terminal',
};

export function Badge({ variant = 'outline', icon, className, children, ...rest }: BadgeProps) {
  const classes = [styles.badge, styles[VARIANT_CLASS[variant]], className]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} {...rest}>
      {icon}
      {children}
    </span>
  );
}
