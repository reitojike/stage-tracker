import Link from 'next/link';
import { StatePanel } from '@/ui/StatePanel';
import { Surface } from '@/ui/Surface';
import type { SelectedDayOccurrence } from '@/domain/calendarMonth.ts';
import { occurrenceTimeRangeLabel } from '@/domain/catalogFormatting.ts';
import { catalogEventHref, type CatalogParams } from '@/domain/catalogNavigation.ts';
import styles from './SelectedDayList.module.css';

export interface SelectedDayListProps {
  date: string;
  occurrences: readonly SelectedDayOccurrence[];
  context: CatalogParams;
}

function dayLabel(date: string): string {
  const [, monthStr, dayStr] = date.split('-');
  return `${String(Number(monthStr ?? '1'))}月${String(Number(dayStr ?? '1'))}日`;
}

/**
 * All occurrences on one selected day, band and non-band alike, each shown
 * individually - never collapsed by event or by day (product-rules.md
 * "Selected-day list": same-day multiple occurrences are distinct
 * entries). This is the full-detail escape hatch for whatever the month
 * view bounded for scanability (badge exclusion, band overflow).
 */
export function SelectedDayList({ date, occurrences, context }: SelectedDayListProps) {
  return (
    <section aria-label={`${dayLabel(date)}の公演一覧`} className={styles.list}>
      <h2 className={styles.heading}>{dayLabel(date)}</h2>
      {occurrences.length === 0 ? (
        <StatePanel variant="empty" title="この日に登録されている公演はありません" />
      ) : (
        <ul className={styles.items}>
          {occurrences.map(({ event, occurrence }) => (
            <li key={occurrence.id}>
              <Link
                href={catalogEventHref(event.id, context, occurrence.id)}
                className={styles.itemLink}
              >
                <Surface className={styles.item}>
                  <span className={styles.time}>
                    {occurrenceTimeRangeLabel(occurrence.startsAt, occurrence.endsAt)}
                  </span>
                  <span className={styles.title}>{event.title}</span>
                  {event.venue !== null ? (
                    <span className={styles.venue}>{event.venue}</span>
                  ) : null}
                </Surface>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
