import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Badge.module.css';

export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  icon?: ReactNode;
}

const VARIANT_CLASS: Record<BadgeVariant, keyof typeof styles> = {
  neutral: 'neutral',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
};

export function Badge({ variant = 'neutral', icon, className, children, ...rest }: BadgeProps) {
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
