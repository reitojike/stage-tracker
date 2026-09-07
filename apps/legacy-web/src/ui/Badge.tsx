import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Badge.module.css';

/**
 * Issue #138 (4 variants) / Issue #186 (5th variant): Badge is a shape-based
 * variant set instead of success/warning/danger/info/neutral color states.
 * Each variant conveys a fixed meaning regardless of color:
 * - outline: classification (e.g. 宝塚/月組, 一般発売)
 * - subtle: ongoing/intention, not yet a completed action (e.g. 申込中, 参加する)
 * - done: a user-completed action (e.g. 申し込み済み, チケット確保済み) - distinguished
 *   from subtle by both tone and a component-owned checkmark, never color alone
 * - deadline: a deadline that can still be acted on
 * - terminal: ended, no action possible (e.g. 落選, 中止)
 */
export type BadgeVariant = 'outline' | 'subtle' | 'done' | 'deadline' | 'terminal';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  icon?: ReactNode;
}

const VARIANT_CLASS: Record<BadgeVariant, keyof typeof styles> = {
  outline: 'outline',
  subtle: 'subtle',
  done: 'done',
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
      {/* The checkmark is owned by the component, not the caller's label
          string, so every done badge stays consistent and callers never
          embed "✓" themselves. It's aria-hidden so the accessible name
          comes from the visible label text alone, not "check mark <label>". */}
      {variant === 'done' ? <span aria-hidden="true">✓ </span> : null}
      {children}
    </span>
  );
}
