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
 * product-rules.md "Catalog の日程参照要件"). Since Issue #91, MonthCalendar
 * also bands such an event by its Event range, so it is no longer the
 * *only* place these events render - but that band is not a guaranteed
 * fallback: SelectedDayList only ever surfaces actual occurrences (Issue
 * #91: badge/selected-day derive from occurrence rows only, never from the
 * range), so a 0-occurrence event has no occurrence-driven detail view to
 * fall back to the way an occurrence-bearing event does when its band
 * overflows a week's lane cap (layoutWeekBands' overflowCount). This list
 * stays as the one surface that keeps such an event from being silently
 * unreachable regardless of band lane pressure - deliberately a plain
 * list, not itself a calendar band (Event range band visual design is out
 * of scope here too).
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
