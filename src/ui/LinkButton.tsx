import Link from 'next/link';
import type { ComponentProps } from 'react';
import type { ButtonVariant } from './Button';
import { LinkPending } from './LinkPending';
import styles from './Button.module.css';

export interface LinkButtonProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant;
  /**
   * Set false to omit the in-flight LinkPending indicator - e.g. a
   * calendar month-nav icon button (#102), where transition pending
   * feedback is a separate, not-yet-implemented concern (#103). Defaults
   * to true, unchanged for every other current consumer.
   */
  showPending?: boolean;
}

/**
 * A navigation control that reads as a Button but is a real link, so
 * href semantics (open in a new tab, keyboard link behaviour, prefetch)
 * keep working. Deliberately reuses Button.module.css instead of
 * restating the same tokens - a bare `<Link>` with no styling is exactly
 * the raw-prototype presentation #70 is correcting, and a second
 * stylesheet would only drift from Button's.
 *
 * Carries LinkPending so a tapped action shows it was accepted while the
 * server navigation is still in flight, unless the caller opts out via
 * showPending.
 */
export function LinkButton({
  variant = 'primary',
  className,
  children,
  showPending = true,
  ...rest
}: LinkButtonProps) {
  const classes = [styles.button, styles[variant], styles.asLink, className]
    .filter(Boolean)
    .join(' ');

  return (
    <Link className={classes} {...rest}>
      {children}
      {showPending ? <LinkPending /> : null}
    </Link>
  );
}
