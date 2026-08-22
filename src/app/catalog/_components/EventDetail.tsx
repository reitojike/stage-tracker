import Link from 'next/link';
import { Surface } from '@/ui/Surface';
import type { EventWithOccurrences } from '@/domain/eventCatalog.ts';
import {
  isRenderableHttpUrl,
  occurrenceTimeRangeLabel,
  tokyoDateLabel,
} from '@/domain/catalogFormatting.ts';
import styles from './EventDetail.module.css';

export interface EventDetailProps {
  data: EventWithOccurrences;
  /**
   * Where to edit this event, or null when the viewer may not (Issue
   * #29). Resolved by the page from the event's owner, so this component
   * renders an affordance rather than deciding who gets one - and an
   * absent link is a presentation choice, not the enforcement boundary
   * (that is RLS).
   */
  editHref?: string | null;
}

/**
 * Inspect surface for one event and its occurrences (Issue #20). Shows
 * only fields already present on the #12 read model - no new product
 * field. The single write affordance is the owner-only edit link (Issue
 * #29); the fields themselves remain read-only here.
 */
export function EventDetail({ data, editHref = null }: EventDetailProps) {
  const { event, occurrences } = data;

  return (
    <article className={styles.detail}>
      <h1 className={styles.title}>{event.title}</h1>

      {editHref !== null ? <Link href={editHref}>この公演情報を編集</Link> : null}

      <dl className={styles.meta}>
        {event.venue !== null ? (
          <div className={styles.metaRow}>
            <dt>会場</dt>
            <dd>{event.venue}</dd>
          </div>
        ) : null}
        {event.sourceUrl !== null ? (
          <div className={styles.metaRow}>
            <dt>参照URL</dt>
            <dd>
              {isRenderableHttpUrl(event.sourceUrl) ? (
                <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer">
                  {event.sourceUrl}
                </a>
              ) : (
                event.sourceUrl
              )}
            </dd>
          </div>
        ) : null}
        {event.memo !== null ? (
          <div className={styles.metaRow}>
            <dt>メモ</dt>
            <dd>{event.memo}</dd>
          </div>
        ) : null}
      </dl>

      <div>
        <h2 className={styles.subheading}>公演回</h2>
        <Surface variant="subtle">
          <ul className={styles.occurrenceList}>
            {occurrences.map((occurrence) => (
              <li key={occurrence.id}>
                {tokyoDateLabel(occurrence.startsAt)}{' '}
                {occurrenceTimeRangeLabel(occurrence.startsAt, occurrence.endsAt)}
              </li>
            ))}
          </ul>
        </Surface>
      </div>
    </article>
  );
}
