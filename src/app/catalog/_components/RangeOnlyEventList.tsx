import Link from 'next/link';
import { Surface } from '@/ui/Surface';
import type { EventWithOccurrences } from '@/domain/eventCatalog.ts';
import { catalogEventHref, type CatalogParams } from '@/domain/catalogNavigation.ts';
import styles from './RangeOnlyEventList.module.css';

export interface RangeOnlyEventListProps {
  events: readonly EventWithOccurrences[];
  context: CatalogParams;
}

/**
 * Events whose Event range overlaps the displayed month but have no
 * occurrence within it (Issue #88: an event may have zero occurrences, and
 * "no occurrence this month" does not mean "not relevant this month" - see
 * product-rules.md "Catalog の日程参照要件"). MonthCalendar/SelectedDayList
 * are both occurrence-driven (band segments, badges, per-day lists), so
 * without this, such an event would never render anywhere on the page even
 * though the read layer already returns it (listEventCatalogInRange) -
 * `result.data.length > 0` with nothing visible and no empty-state message
 * either. This is the minimum surface that keeps it from being silently
 * invisible - deliberately a plain list, not a calendar band (Event range
 * band visual design is out of scope for Issue #88).
 *
 * "公演回未発表" is deliberately avoided as a label: `occurrences` here is
 * scoped to the queried month, not to the whole event, so an event that
 * does have occurrences elsewhere (just not this month) reaches this list
 * too - a neutral label ("開催期間で該当するイベント") does not claim more
 * than "this event's range overlaps what you're looking at".
 */
export function RangeOnlyEventList({ events, context }: RangeOnlyEventListProps) {
  const rangeOnly = events.filter((group) => group.occurrences.length === 0);
  if (rangeOnly.length === 0) {
    return null;
  }

  return (
    <section aria-label="開催期間で該当するイベント" className={styles.list}>
      <h2 className={styles.heading}>開催期間で該当するイベント</h2>
      <ul className={styles.items}>
        {rangeOnly.map(({ event }) => (
          <li key={event.id}>
            <Link href={catalogEventHref(event.id, context)} className={styles.itemLink}>
              <Surface variant="subtle" className={styles.item}>
                <span className={styles.title}>{event.title}</span>
                <span className={styles.range}>
                  {event.startsOn}〜{event.endsOn}
                </span>
                {event.venue !== null ? <span className={styles.venue}>{event.venue}</span> : null}
              </Surface>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
