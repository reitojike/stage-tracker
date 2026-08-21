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
}

/**
 * Read-only inspect surface for one event and its occurrences (Issue #20).
 * Shows only fields already present on the #12 read model - no new
 * product field, and no write affordance (this slice is read-only).
 */
export function EventDetail({ data }: EventDetailProps) {
  const { event, occurrences } = data;

  return (
    <article className={styles.detail}>
      <h1 className={styles.title}>{event.title}</h1>

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
