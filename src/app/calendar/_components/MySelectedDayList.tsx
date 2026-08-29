import Link from 'next/link';
import { Badge } from '@/ui/Badge';
import { DayRoleText } from '@/ui/DayRoleText';
import { StatePanel } from '@/ui/StatePanel';
import type { MyCalendarOccurrenceEntry, MyCalendarScheduleEntry } from '@/domain/myCalendar.ts';
import { isEffectivelyCanceled } from '@/domain/eventCancellation.ts';
import { occurrenceTimeRangeLabel } from '@/domain/catalogFormatting.ts';
import { catalogEventHref, type CatalogParams } from '@/domain/catalogNavigation.ts';
import {
  participationStatusLabel,
  ticketDisplayStatusBadgeVariant,
  ticketDisplayStatusLabel,
} from '@/domain/myCalendarFormatting.ts';
import { scheduleTemporalLabel } from '@/domain/personalScheduleFormatting.ts';
import {
  calendarDateAccessibleWeekdayLabel,
  calendarDateWeekdayLabel,
  calendarDayRole,
} from '@/domain/calendarDayRole.ts';
import styles from './MySelectedDayList.module.css';

export interface MySelectedDayListProps {
  date: string;
  occurrenceEntries: readonly MyCalendarOccurrenceEntry[];
  scheduleEntries: readonly MyCalendarScheduleEntry[];
  /** Month/day context to carry into the linked event detail page (docs/ux-ui.md
   * primary interaction pattern: "month calendar -> selected-day list ->
   * event detail"). Reuses catalogEventHref's own CatalogParams shape - the
   * event detail page itself is the shared Event Catalog one, not a
   * My-Calendar-specific copy. */
  eventDetailContext: CatalogParams;
}

/**
 * Full detail for one selected day: every participation-registered
 * occurrence (with its ticket state) and every visible personal-schedule
 * entry active that day (own or shared) - the escape hatch for whatever
 * the month view only summarized as counts/markers (Issue #34 MVP surface:
 * "selected-day contextで必要なpersonal schedule / event informationを
 * 確認可能").
 */
export function MySelectedDayList({
  date,
  occurrenceEntries,
  scheduleEntries,
  eventDetailContext,
}: MySelectedDayListProps) {
  const isEmpty = occurrenceEntries.length === 0 && scheduleEntries.length === 0;

  return (
    <section
      aria-label={`${calendarDateAccessibleWeekdayLabel(date)}のカレンダー詳細`}
      className={styles.list}
    >
      <DayRoleText as="h2" role={calendarDayRole(date)} className={styles.heading}>
        {calendarDateWeekdayLabel(date)}
      </DayRoleText>

      {isEmpty ? (
        <StatePanel variant="empty" title="この日に登録されている予定はありません" />
      ) : (
        <ul className={styles.items}>
          {occurrenceEntries.map(({ event, occurrence, participation, ticketStatus }) => (
            <li key={occurrence.id} className={styles.item}>
              <Link
                href={catalogEventHref(event.id, eventDetailContext, occurrence.id)}
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
                  <span className={styles.badgeRow}>
                    <Badge variant="subtle">{participationStatusLabel(participation.status)}</Badge>
                    <Badge variant={ticketDisplayStatusBadgeVariant(ticketStatus)}>
                      {ticketDisplayStatusLabel(ticketStatus)}
                    </Badge>
                    {isEffectivelyCanceled(event, occurrence) ? (
                      <Badge variant="terminal">中止</Badge>
                    ) : null}
                  </span>
                </span>
                <span className={styles.chevron} aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          ))}

          {scheduleEntries.map(({ entry, isOwner }) => (
            <li key={entry.id} className={styles.item}>
              {/* Links into the existing /schedule/[entryId] detail page
                  (Issue #92 Goal: this row must reach the same edit/share
                  management or read/self-remove journey that page already
                  provides - no duplicate schedule mutation UI here, same
                  href convention as src/app/schedule/page.tsx's own list). */}
              <Link href={`/schedule/${entry.id}`} className={styles.itemLink}>
                <span className={styles.itemBody}>
                  <span className={styles.badgeRow}>
                    <Badge variant="subtle">{isOwner ? '自分の予定' : '共有されている予定'}</Badge>
                    {!entry.blocking ? <Badge variant="outline">予定を確保しない</Badge> : null}
                  </span>
                  <span className={styles.title}>{entry.title}</span>
                  <span className={styles.time}>{scheduleTemporalLabel(entry.temporal)}</span>
                  {entry.memo !== null && entry.memo.length > 0 ? (
                    <span className={styles.venue}>{entry.memo}</span>
                  ) : null}
                </span>
                <span className={styles.chevron} aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
