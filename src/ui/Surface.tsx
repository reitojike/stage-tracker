import type { HTMLAttributes } from 'react';
import styles from './Surface.module.css';

export type SurfaceVariant = 'default' | 'subtle';

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  variant?: SurfaceVariant;
}

export function Surface({ variant = 'default', className, ...rest }: SurfaceProps) {
  const variantClass = variant === 'default' ? styles.default : styles.subtle;
  const classes = [styles.surface, variantClass, className].filter(Boolean).join(' ');

  return <div className={classes} {...rest} />;
}
