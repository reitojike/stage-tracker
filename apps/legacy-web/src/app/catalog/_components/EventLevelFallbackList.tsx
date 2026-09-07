import Link from 'next/link';
import { Badge } from '@/ui/Badge';
import type { EventClassification, EventWithOccurrences } from '@/domain/eventCatalog.ts';
import { eventDateRangeLabel } from '@/domain/catalogFormatting.ts';
import { classificationBadgeLabel } from '@/domain/catalogFilterIntegration.ts';
import { isEventCanceled } from '@/domain/eventCancellation.ts';
import { catalogEventHref, type CatalogParams } from '@/domain/catalogNavigation.ts';
import styles from './EventLevelFallbackList.module.css';

export interface EventLevelFallbackListProps {
  /** Already-derived Event-level fallback candidates for the selected day
   * (see selectEventLevelFallback in calendarMonth.ts) - this component
   * renders only, it never re-derives which events qualify. */
  events: readonly EventWithOccurrences[];
  context: CatalogParams;
  /** Event id -> #167 classification, for the optional genre Badge below -
   * same "absent = unclassified = no badge" contract as SelectedDayList's
   * own classificationByEventId. Optional: CatalogView.tsx (the current
   * sole caller) always supplies it; the default below (NO_CLASSIFICATIONS)
   * exists so a caller without per-event classification data still renders
   * every row with no genre badge, never a crash. */
  classificationByEventId?: ReadonlyMap<string, EventClassification>;
}

const NO_CLASSIFICATIONS: ReadonlyMap<string, EventClassification> = new Map();

/**
 * The selected-day counterpart to SelectedDayList (Issue #109): events whose
 * Event range covers the selected day but have no actual occurrence on it
 * (selectEventLevelFallback). This is a *complement* to SelectedDayList, not
 * an independent fallback surface - the caller (CatalogView.tsx) derives both
 * lists from the same selected date, and by construction an event never appears in
 * both (an occurrence on the selected day excludes it here; see
 * selectEventLevelFallback's doc comment). An event's own occurrences
 * elsewhere in the month do not exclude it here either - only an occurrence
 * on the selected day itself does.
 *
 * Formerly RangeOnlyEventList, which also rendered a broader month-landing
 * fallback (every 0-occurrence event overlapping the displayed month, no day
 * selected) - Issue #109 removes that surface: the month view's single-day
 * count / multi-day band (Issue #91's buildMonthCalendarViewModel) is now
 * the only landing-view presentation, so this component only ever renders
 * once a day is selected (CatalogView.tsx does not call it otherwise).
 *
 * "公演回未発表" is deliberately avoided as a label: a neutral label
 * ("開催期間で該当するイベント") does not claim more than "this event's
 * range covers the selected day".
 */
export function EventLevelFallbackList({
  events,
  context,
  classificationByEventId = NO_CLASSIFICATIONS,
}: EventLevelFallbackListProps) {
  if (events.length === 0) {
    return null;
  }

  return (
    <section aria-label="開催期間で該当するイベント" className={styles.list}>
      <h2 className={styles.heading}>開催期間で該当するイベント</h2>
      <ul className={styles.items}>
        {events.map(({ event }) => {
          const badgeLabel = classificationBadgeLabel(
            classificationByEventId.get(event.id) ?? null,
            event.venue,
          );
          const canceled = isEventCanceled(event);
          return (
            <li key={event.id}>
              <Link href={catalogEventHref(event.id, context)} className={styles.itemLink}>
                <span className={styles.itemBody}>
                  <span className={styles.title}>{event.title}</span>
                  <span className={styles.range}>
                    {eventDateRangeLabel(event.startsOn, event.endsOn)}
                  </span>
                  {event.venue !== null ? (
                    <span className={styles.venue}>{event.venue}</span>
                  ) : null}
                  {badgeLabel !== null || canceled ? (
                    <span className={styles.badges}>
                      {badgeLabel !== null ? <Badge variant="outline">{badgeLabel}</Badge> : null}
                      {canceled ? <Badge variant="terminal">中止</Badge> : null}
                    </span>
                  ) : null}
                </span>
                <span className={styles.chevron} aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
