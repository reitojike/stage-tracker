import styles from './WriteNotice.module.css';

export interface WriteNoticeProps {
  notice: string | null;
  attempt: number;
}

/** Stable polite live region for completed write feedback. */
export function WriteNotice({ notice, attempt }: WriteNoticeProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={[styles.noticeRegion, notice === null ? styles.noticeRegionEmpty : undefined]
        .filter(Boolean)
        .join(' ')}
    >
      {notice !== null ? (
        <p key={attempt} className={styles.notice}>
          {notice}
        </p>
      ) : null}
    </div>
  );
}
