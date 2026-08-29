import Link from 'next/link';
import { Badge } from '@/ui/Badge';
import { DayRoleText } from '@/ui/DayRoleText';
import { StatePanel } from '@/ui/StatePanel';
import type { SelectedDayOccurrence } from '@/domain/calendarMonth.ts';
import { isEffectivelyCanceled } from '@/domain/eventCancellation.ts';
import { occurrenceTimeRangeLabel } from '@/domain/catalogFormatting.ts';
import { catalogEventHref, type CatalogParams } from '@/domain/catalogNavigation.ts';
import type { EventClassification } from '@/domain/eventCatalog.ts';
import {
  calendarDateAccessibleWeekdayLabel,
  calendarDateWeekdayLabel,
  calendarDayRole,
} from '@/domain/calendarDayRole.ts';
import styles from './SelectedDayList.module.css';

export interface SelectedDayListProps {
  date: string;
  occurrences: readonly SelectedDayOccurrence[];
  context: CatalogParams;
  /** Event id -> #167 classification, for the optional genre Badge below -
   * an id absent here renders no badge, the same treatment as an event with
   * no genre (Issue #145 "unclassifiedはbadgeなし"). This component never
   * derives/推測 a genre from title/venue text itself. */
  classificationByEventId: ReadonlyMap<string, EventClassification>;
}

/**
 * All occurrences on one selected day, band and non-band alike, each shown
 * individually - never collapsed by event or by day (product-rules.md
 * "Selected-day list": same-day multiple occurrences are distinct
 * entries). This is the full-detail escape hatch for whatever the month
 * view bounded for scanability (badge exclusion, band overflow).
 */
export function SelectedDayList({
  date,
  occurrences,
  context,
  classificationByEventId,
}: SelectedDayListProps) {
  return (
    <section
      aria-label={`${calendarDateAccessibleWeekdayLabel(date)}の公演一覧`}
      className={styles.list}
    >
      <DayRoleText as="h2" role={calendarDayRole(date)} className={styles.heading}>
        {calendarDateWeekdayLabel(date)}
      </DayRoleText>
      {occurrences.length === 0 ? (
        <StatePanel variant="empty" title="この日に登録されている公演はありません" />
      ) : (
        <ul className={styles.items}>
          {occurrences.map(({ event, occurrence }) => {
            const genre = classificationByEventId.get(event.id)?.genre ?? null;
            const canceled = isEffectivelyCanceled(event, occurrence);
            return (
              <li key={occurrence.id}>
                <Link
                  href={catalogEventHref(event.id, context, occurrence.id)}
                  className={styles.itemLink}
                >
                  <span className={styles.itemBody}>
                    <span className={styles.time}>
                      {occurrenceTimeRangeLabel(occurrence.startsAt, occurrence.endsAt)}
                    </span>
                    <span className={styles.title}>{event.title}</span>
                    {event.venue !== null ? (
                      <span className={styles.venue}>{event.venue}</span>
                    ) : null}
                    {genre !== null || canceled ? (
                      <span className={styles.badges}>
                        {genre !== null ? (
                          <Badge variant="outline">{genre.displayName}</Badge>
                        ) : null}
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
      )}
    </section>
  );
}
