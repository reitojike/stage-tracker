import Link from 'next/link';
import type { ComponentProps } from 'react';
import type { ButtonVariant } from './Button';
import { LinkPending } from './LinkPending';
import styles from './Button.module.css';

export interface LinkButtonProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant;
}

const VARIANT_CLASS: Record<ButtonVariant, keyof typeof styles> = {
  primary: 'primary',
  secondary: 'secondary',
  small: 'small',
  quiet: 'quiet',
  icon: 'icon',
};

/**
 * A navigation control that reads as a Button but is a real link, so
 * href semantics (open in a new tab, keyboard link behaviour, prefetch)
 * keep working. Deliberately reuses Button.module.css instead of
 * restating the same tokens - a bare `<Link>` with no styling is exactly
 * the raw-prototype presentation #70 is correcting, and a second
 * stylesheet would only drift from Button's.
 *
 * Carries LinkPending so a tapped action shows it was accepted while the
 * server navigation is still in flight.
 */
export function LinkButton({ variant = 'primary', className, children, ...rest }: LinkButtonProps) {
  const classes = [styles.button, styles[VARIANT_CLASS[variant]], styles.asLink, className]
    .filter(Boolean)
    .join(' ');

  return (
    <Link className={classes} {...rest}>
      {children}
      <LinkPending />
    </Link>
  );
}
