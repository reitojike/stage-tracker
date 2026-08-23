import styles from './ScheduleWriteForm.module.css';

export interface ScheduleWriteNoticeProps {
  /** The confirmation text for a completed write, or null. */
  notice: string | null;
  /** The form state's attempt counter, used as the message's key. */
  attempt: number;
}

/**
 * Announces a completed personal schedule write (Issue #37). Mirrors
 * src/app/catalog/_components/WriteNotice.tsx exactly - see there for why
 * the live region is always mounted and the message is keyed by `attempt`.
 */
export function ScheduleWriteNotice({ notice, attempt }: ScheduleWriteNoticeProps) {
  return (
    <div role="status" aria-live="polite" className={styles.noticeRegion}>
      {notice !== null ? (
        <p key={attempt} className={styles.notice}>
          {notice}
        </p>
      ) : null}
    </div>
  );
}
