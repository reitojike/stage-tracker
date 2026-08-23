import { Badge } from '@/ui/Badge';
import { Surface } from '@/ui/Surface';
import { StatePanel } from '@/ui/StatePanel';
import type { MyCalendarOccurrenceEntry, MyCalendarScheduleEntry } from '@/domain/myCalendar.ts';
import { occurrenceTimeRangeLabel } from '@/domain/catalogFormatting.ts';
import {
  participationStatusLabel,
  ticketDisplayStatusBadgeVariant,
  ticketDisplayStatusLabel,
} from '@/domain/myCalendarFormatting.ts';
import { scheduleTemporalLabel, scheduleTypeLabel } from '@/domain/personalScheduleFormatting.ts';
import { calendarDayRole, calendarDayRoleLabel } from '@/domain/calendarDayRole.ts';
import styles from './MySelectedDayList.module.css';

export interface MySelectedDayListProps {
  date: string;
  occurrenceEntries: readonly MyCalendarOccurrenceEntry[];
  scheduleEntries: readonly MyCalendarScheduleEntry[];
}

function dayLabel(date: string): string {
  const [, monthStr, dayStr] = date.split('-');
  const role = calendarDayRole(date);
  const roleLabel = calendarDayRoleLabel(date);
  const base = `${String(Number(monthStr ?? '1'))}月${String(Number(dayStr ?? '1'))}日`;
  if (role === 'weekday' || roleLabel === null) {
    return base;
  }
  return `${base}（${roleLabel}）`;
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
}: MySelectedDayListProps) {
  const isEmpty = occurrenceEntries.length === 0 && scheduleEntries.length === 0;

  return (
    <section aria-label={`${dayLabel(date)}のMy Calendar詳細`} className={styles.list}>
      <h2 className={styles.heading}>{dayLabel(date)}</h2>

      {isEmpty ? (
        <StatePanel variant="empty" title="この日に登録されている予定はありません" />
      ) : (
        <ul className={styles.items}>
          {occurrenceEntries.map(({ event, occurrence, participation, ticketStatus }) => (
            <li key={occurrence.id}>
              <Surface variant="subtle" className={styles.item}>
                <span className={styles.time}>
                  {occurrenceTimeRangeLabel(occurrence.startsAt, occurrence.endsAt)}
                </span>
                <span className={styles.title}>{event.title}</span>
                {event.venue !== null ? <span className={styles.venue}>{event.venue}</span> : null}
                <span className={styles.badgeRow}>
                  <Badge variant={participation.status === 'attending' ? 'success' : 'info'}>
                    {participationStatusLabel(participation.status)}
                  </Badge>
                  <Badge variant={ticketDisplayStatusBadgeVariant(ticketStatus)}>
                    {ticketDisplayStatusLabel(ticketStatus)}
                  </Badge>
                </span>
              </Surface>
            </li>
          ))}

          {scheduleEntries.map(({ entry, isOwner }) => (
            <li key={entry.id}>
              <Surface variant="subtle" className={styles.item}>
                <span className={styles.badgeRow}>
                  <Badge variant={isOwner ? 'neutral' : 'info'}>
                    {isOwner ? '自分の予定' : '共有されている予定'}
                  </Badge>
                </span>
                <span className={styles.title}>{scheduleTypeLabel(entry.scheduleType)}</span>
                <span className={styles.time}>{scheduleTemporalLabel(entry.temporal)}</span>
                {entry.memo !== null && entry.memo.length > 0 ? (
                  <span className={styles.venue}>{entry.memo}</span>
                ) : null}
              </Surface>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
