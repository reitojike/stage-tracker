import Link from 'next/link';
import { Badge } from '@/ui/Badge';
import { isEffectivelyCanceled } from '@/domain/eventCancellation.ts';
import { occurrenceTimeRangeLabel } from '@/domain/catalogFormatting.ts';
import { catalogEventHref, type CatalogParams } from '@/domain/catalogNavigation.ts';
import { participationStatusLabel } from '@/domain/myCalendarFormatting.ts';
import { scheduleTemporalLabel } from '@/domain/personalScheduleFormatting.ts';
import { tokyoCalendarDateFromInstant } from '@/domain/eventCatalog.ts';
import { calendarDayRole, calendarDayRoleLabel } from '@/domain/calendarDayRole.ts';
import type { HomeUpcomingDateGroup, HomeUpcomingItem } from '@/domain/homeUpcoming.ts';
import styles from './HomeUpcomingList.module.css';

export interface HomeUpcomingListProps {
  /** Already selected/ordered/grouped via domain/homeUpcoming.ts - this
   * component adds no candidacy/ordering judgment of its own. */
  dateGroups: readonly HomeUpcomingDateGroup[];
}

/** "8月28日（金）" - same weekday-aware date label MySelectedDayList uses
 * for its own selected-day heading, reused here per date group instead of
 * per selected day. */
function dateGroupHeadingLabel(date: string): string {
  const [, monthStr, dayStr] = date.split('-');
  const role = calendarDayRole(date);
  const roleLabel = calendarDayRoleLabel(date);
  const base = `${String(Number(monthStr ?? '1'))}月${String(Number(dayStr ?? '1'))}日`;
  return role === 'weekday' || roleLabel === null ? base : `${base}（${roleLabel}）`;
}

/** The occurrence's own Tokyo calendar date as an Event-detail deep-link
 * context (CatalogParams) - Home has no month/day navigation state of its
 * own to carry, unlike My Calendar (src/app/calendar/page.tsx), so this
 * derives one directly from the occurrence being linked. */
function occurrenceEventDetailContext(startsAt: string): CatalogParams {
  const date = tokyoCalendarDateFromInstant(startsAt);
  return { yearMonth: date.slice(0, 7), selectedDate: date };
}

function UpcomingRow({ item }: { item: HomeUpcomingItem }) {
  if (item.kind === 'occurrence') {
    const { event, occurrence, participation } = item;
    return (
      <Link
        href={catalogEventHref(
          event.id,
          occurrenceEventDetailContext(occurrence.startsAt),
          occurrence.id,
        )}
        className={styles.itemLink}
      >
        <span className={styles.itemBody}>
          <span className={styles.time}>
            {occurrenceTimeRangeLabel(occurrence.startsAt, occurrence.endsAt)}
          </span>
          <span className={styles.title}>{event.title}</span>
          {event.venue !== null ? <span className={styles.venue}>{event.venue}</span> : null}
          <span className={styles.badgeRow}>
            <Badge variant="subtle">{participationStatusLabel(participation.status)}</Badge>
            {isEffectivelyCanceled(event, occurrence) ? (
              <Badge variant="terminal">中止</Badge>
            ) : null}
          </span>
        </span>
        <span className={styles.chevron} aria-hidden="true">
          ›
        </span>
      </Link>
    );
  }

  const { entry, isOwner } = item;
  return (
    <Link href={`/schedule/${entry.id}`} className={styles.itemLink}>
      <span className={styles.itemBody}>
        <span className={styles.badgeRow}>
          <Badge variant="subtle">{isOwner ? '自分の予定' : '共有されている予定'}</Badge>
          {!entry.blocking ? <Badge variant="outline">予定を確保しない</Badge> : null}
        </span>
        <span className={styles.title}>{entry.title}</span>
        <span className={styles.time}>{scheduleTemporalLabel(entry.temporal)}</span>
      </span>
      <span className={styles.chevron} aria-hidden="true">
        ›
      </span>
    </Link>
  );
}

/**
 * Home's "直近の予定" block (Issue #143 Task Contract): a date-grouped
 * vertical list mixing participation-registered occurrences and visible
 * personal schedule (own + shared), plain-row/hairline-separator
 * presentation - no card Surface (docs/ux-ui.md "Spacing / surface /
 * radius", Issue #146 precedent this mirrors, same row vocabulary as
 * src/app/calendar/_components/MySelectedDayList.tsx). Deliberately carries
 * no ticket-acquisition status badge - Home's upcoming projection never
 * reads the legacy ticket_acquisitions boundary.
 */
export function HomeUpcomingList({ dateGroups }: HomeUpcomingListProps) {
  return (
    <div className={styles.list}>
      {dateGroups.map((group) => (
        <section key={group.date} aria-label={dateGroupHeadingLabel(group.date)}>
          <h3 className={styles.dateHeading}>{dateGroupHeadingLabel(group.date)}</h3>
          <ul className={styles.items}>
            {group.items.map((item) => (
              <li
                key={item.kind === 'occurrence' ? item.occurrence.id : item.entry.id}
                className={styles.item}
              >
                <UpcomingRow item={item} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
