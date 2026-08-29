import Link from 'next/link';
import { DayRoleText } from '@/ui/DayRoleText';
import { LinkButton } from '@/ui/LinkButton';
import { StatePanel } from '@/ui/StatePanel';
import type { MyCalendarOccurrenceEntry, MyCalendarScheduleEntry } from '@/domain/myCalendar.ts';
import { myCalendarMonthDayLabel } from '@/domain/myCalendarFormatting.ts';
import {
  calendarDateAccessibleWeekdayLabel,
  calendarDateWeekdayLabel,
  calendarDayRole,
} from '@/domain/calendarDayRole.ts';
import type { CatalogParams } from '@/domain/catalogNavigation.ts';
import { scheduleNewHrefForDate } from '@/domain/myCalendarNavigation.ts';
import { MyCalendarEntryRow } from './MyCalendarEntryRow.tsx';
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
  const addLabel = `${myCalendarMonthDayLabel(date)}に予定を追加`;
  const addHref = scheduleNewHrefForDate(date);

  return (
    <section
      aria-label={`${calendarDateAccessibleWeekdayLabel(date)}のカレンダー詳細`}
      className={styles.list}
    >
      <DayRoleText as="h2" role={calendarDayRole(date)} className={styles.heading}>
        {calendarDateWeekdayLabel(date)}
      </DayRoleText>

      {isEmpty ? (
        // Issue #196: a first-time user is especially likely to land on an
        // empty day, so this state gets a **primary** add action rather than
        // the plain add row below (which non-empty days get instead).
        <StatePanel
          variant="empty"
          title="この日の予定はまだありません"
          action={<LinkButton href={addHref}>{addLabel}</LinkButton>}
        />
      ) : (
        <ul className={styles.items}>
          {occurrenceEntries.map((occurrenceEntry) => (
            <li key={occurrenceEntry.occurrence.id} className={styles.item}>
              <MyCalendarEntryRow
                item={{ kind: 'occurrence', occurrenceEntry }}
                eventDetailContext={eventDetailContext}
              />
            </li>
          ))}

          {scheduleEntries.map((scheduleEntry) => (
            <li key={scheduleEntry.entry.id} className={styles.item}>
              <MyCalendarEntryRow
                item={{ kind: 'schedule', scheduleEntry }}
                eventDetailContext={eventDetailContext}
              />
            </li>
          ))}

          {/* Issue #196: a selected day's list always ends with this add
              row (its own closing hairline - see .addRow in the CSS
              module), so adding another entry for the same day is always
              one tap away without leaving the list. */}
          <li className={styles.addRow}>
            <Link href={addHref} className={styles.addRowLink}>
              <span className={styles.addRowIcon} aria-hidden="true">
                +
              </span>
              {addLabel}
            </Link>
          </li>
        </ul>
      )}
    </section>
  );
}
