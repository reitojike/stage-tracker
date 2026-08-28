import styles from './TicketOpportunityWriteNotice.module.css';

export interface TicketOpportunityWriteNoticeProps {
  /** The confirmation text for a completed write, or null. */
  notice: string | null;
  /** The form state's attempt counter, used as the message's key. */
  attempt: number;
}

/**
 * Announces a completed personal planning-state write (Issue #144). Mirrors
 * src/app/catalog/_components/WriteNotice.tsx's own shape and reasoning -
 * each feature keeps its own copy of this small presentational component
 * rather than importing across feature `_components` folders (same
 * per-feature-duplication convention as src/app/tickets/_actions/
 * formHelpers.ts's readId and src/app/tickets/_lib/today.ts).
 *
 * The live region and the message it carries are deliberately separate
 * elements: a region that mounts together with its first message is
 * announced unreliably by assistive technology, which needs the region to
 * already exist to notice content arriving in it - so the wrapper is always
 * rendered. The message is keyed by `attempt` so submitting the same
 * transition twice still replaces the node inside the stable region (a
 * changing key is what actually triggers the announcement); `role="status"`
 * rather than an alert, since a completed write is confirmation, not
 * something demanding attention.
 */
export function TicketOpportunityWriteNotice({
  notice,
  attempt,
}: TicketOpportunityWriteNoticeProps) {
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
