import Link from 'next/link';
import { Surface } from '@/ui/Surface';
import type { EventWithOccurrences } from '@/domain/eventCatalog.ts';
import { catalogEventHref, type CatalogParams } from '@/domain/catalogNavigation.ts';
import { selectRangeOnlyEvents } from '@/domain/calendarMonth.ts';
import styles from './RangeOnlyEventList.module.css';

export interface RangeOnlyEventListProps {
  events: readonly EventWithOccurrences[];
  context: CatalogParams;
}

/**
 * Events whose Event range overlaps the displayed month but have no
 * occurrence within it (Issue #88: an event may have zero occurrences, and
 * "no occurrence this month" does not mean "not relevant this month" - see
 * product-rules.md "Catalog の日程参照要件"). Since Issue #91, a *multi-day*
 * 0-occurrence event still renders its own title as a band directly on the
 * grid (Issue #91 PO decision) - unless a week's lane cap overflows it, in
 * which case only layoutWeekBands' overflowEvents still links to it there.
 * A *single-day* 0-occurrence event never bands at all (same PO decision):
 * it is represented only by an untitled day-number count, with no title or
 * link anywhere else on the grid. Either way, SelectedDayList only ever
 * surfaces actual occurrences (badge/selected-day derive from occurrence
 * rows only, never from the range), so a 0-occurrence event - single-day or
 * multi-day - has no occurrence-driven detail view to fall back on. This
 * list stays as the one surface that guarantees every 0-occurrence event's
 * title/link is reachable somewhere on the page, regardless of band lane
 * pressure or single-day/multi-day classification - deliberately a plain
 * list, not itself a calendar band (Event range band visual design is out
 * of scope here too).
 *
 * "公演回未発表" is deliberately avoided as a label: `occurrences` here is
 * scoped to the queried month, not to the whole event, so an event that
 * does have occurrences elsewhere (just not this month) reaches this list
 * too - a neutral label ("開催期間で該当するイベント") does not claim more
 * than "this event's range overlaps what you're looking at".
 *
 * Issue #100: with no day selected, every 0-occurrence event overlapping
 * the displayed month still qualifies (unchanged month-level fallback
 * above). Once a day is selected, this list narrows to only the
 * 0-occurrence events whose Event range (startsOn..endsOn, inclusive)
 * contains that day - otherwise a range-only event from elsewhere in the
 * month reads as if it were relevant to the selected day, which it isn't.
 * The selection itself lives in selectRangeOnlyEvents (calendarMonth.ts),
 * next to the occurrence-side equivalent (selectDayOccurrences), so it's
 * unit-testable without rendering.
 */
export function RangeOnlyEventList({ events, context }: RangeOnlyEventListProps) {
  const rangeOnly = selectRangeOnlyEvents(events, context.selectedDate);
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
