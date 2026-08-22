import styles from './EventWriteForm.module.css';

export interface WriteNoticeProps {
  /** The confirmation text for a completed write, or null. */
  notice: string | null;
  /** The form state's attempt counter, used as the message's key. */
  attempt: number;
}

/**
 * Announces a completed write (Issue #29).
 *
 * The live region and the message it carries are deliberately separate
 * elements. A region that is mounted together with its first message is
 * announced unreliably - assistive technology needs the region to already
 * exist in order to notice content arriving in it - so the wrapper is
 * always rendered.
 *
 * The message is keyed by `attempt` for the case the wrapper alone does not
 * cover: saving the same form twice produces the same notice string, and
 * without a changing key React would commit no mutation at all, leaving the
 * second save silent. Keying the message replaces the node inside the
 * stable region, which is what actually triggers the announcement.
 *
 * `role="status"` rather than an alert: a completed save is confirmation,
 * not something demanding attention.
 */
export function WriteNotice({ notice, attempt }: WriteNoticeProps) {
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
