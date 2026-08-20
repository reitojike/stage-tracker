import styles from './LoadingIndicator.module.css';

export interface LoadingIndicatorProps {
  label?: string;
}

export function LoadingIndicator({ label = '読み込み中' }: LoadingIndicatorProps) {
  return (
    <span role="status" aria-label={label}>
      <span className={styles.spinner} aria-hidden="true" />
    </span>
  );
}
