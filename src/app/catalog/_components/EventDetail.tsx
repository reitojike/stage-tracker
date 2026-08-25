import { ActionRow } from '@/ui/ActionRow';
import { Badge } from '@/ui/Badge';
import { LinkButton } from '@/ui/LinkButton';
import { PageHeading } from '@/ui/PageHeading';
import { Surface } from '@/ui/Surface';
import type { EventWithOccurrences } from '@/domain/eventCatalog.ts';
import type { Participation } from '@/domain/participation.ts';
import { occurrenceAnchorId } from '@/domain/catalogNavigation.ts';
import {
  isRenderableHttpUrl,
  occurrenceTimeRangeLabel,
  tokyoDateLabel,
} from '@/domain/catalogFormatting.ts';
import { FocusedOccurrenceScroll } from './FocusedOccurrenceScroll.tsx';
import { ParticipationPanel } from './ParticipationPanel.tsx';
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
  /**
   * The viewer's own participation for each occurrence, keyed by
   * occurrence id (Issue #36). `null` means "read successfully, no row" -
   * a legitimate "not participating" state, distinct from the key being
   * absent entirely, which means the read for that occurrence failed and
   * the page has already surfaced that as an error (see
   * events/[eventId]/page.tsx) - this component does not render
   * ParticipationPanel for an occurrence it has no entry for, rather than
   * guessing at a default.
   */
  participationsByOccurrenceId: ReadonlyMap<string, Participation | null>;
  /**
   * The exact occurrence a selected-day row was chosen for (Issue #107),
   * already re-validated by the page against this event's actual
   * occurrences - null means no occurrence is in focus, which renders
   * exactly as before this feature existed (the generic event-level
   * journey this component always supported).
   */
  focusedOccurrenceId?: string | null;
}

/**
 * Inspect surface for one event and its occurrences (Issue #20), plus each
 * occurrence's participation/invite controls (Issue #36). Shows only fields
 * already present on the #12 read model - no new product field. Owner-only
 * edit link (Issue #29) aside, every other write affordance here is the
 * viewer acting on their own participation, never something scoped to
 * event ownership.
 */
export function EventDetail({
  data,
  editHref = null,
  participationsByOccurrenceId,
  focusedOccurrenceId = null,
}: EventDetailProps) {
  const { event, occurrences } = data;

  return (
    <article className={styles.detail}>
      <FocusedOccurrenceScroll occurrenceId={focusedOccurrenceId} />
      <PageHeading>{event.title}</PageHeading>

      {editHref !== null ? (
        <ActionRow>
          <LinkButton href={editHref} variant="secondary">
            この公演情報を編集
          </LinkButton>
        </ActionRow>
      ) : null}

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
            {occurrences.map((occurrence) => {
              const isFocused = occurrence.id === focusedOccurrenceId;
              return (
                <li
                  key={occurrence.id}
                  id={occurrenceAnchorId(occurrence.id)}
                  tabIndex={isFocused ? -1 : undefined}
                  aria-current={isFocused ? 'true' : undefined}
                  className={isFocused ? styles.occurrenceFocused : undefined}
                >
                  {isFocused ? (
                    <Badge variant="info" className={styles.focusedBadge}>
                      選択した公演回
                    </Badge>
                  ) : null}
                  <p className={styles.occurrenceTime}>
                    {tokyoDateLabel(occurrence.startsAt)}{' '}
                    {occurrenceTimeRangeLabel(occurrence.startsAt, occurrence.endsAt)}
                  </p>
                  {participationsByOccurrenceId.has(occurrence.id) ? (
                    <ParticipationPanel
                      eventId={event.id}
                      occurrenceId={occurrence.id}
                      participation={participationsByOccurrenceId.get(occurrence.id) ?? null}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Surface>
      </div>
    </article>
  );
}
