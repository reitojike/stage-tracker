import styles from './LoadingIndicator.module.css';

export type LoadingIndicatorSize = 'sm' | 'md';

export interface LoadingIndicatorProps {
  label?: string;
  /**
   * `sm` is for inline use alongside a control's own label (e.g. the
   * pending state of a tapped link); `md` stays the standalone
   * page/section-level default.
   */
  size?: LoadingIndicatorSize;
}

export function LoadingIndicator({ label = '読み込み中', size = 'md' }: LoadingIndicatorProps) {
  const classes = [styles.spinner, size === 'sm' ? styles.small : ''].filter(Boolean).join(' ');

  return (
    <span role="status" aria-label={label}>
      <span className={classes} aria-hidden="true" />
    </span>
  );
}
