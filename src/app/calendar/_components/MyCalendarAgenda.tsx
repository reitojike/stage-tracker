import { DayRoleText } from '@/ui/DayRoleText';
import type { MyCalendarAgendaDateGroup, MyCalendarAgendaItem } from '@/domain/myCalendar.ts';
import {
  calendarDateAccessibleWeekdayLabel,
  calendarDateWeekdayLabel,
  calendarDayRole,
} from '@/domain/calendarDayRole.ts';
import { MyCalendarEntryRow } from './MyCalendarEntryRow.tsx';
import styles from './MyCalendarAgenda.module.css';

export interface MyCalendarAgendaProps {
  /** Already projected, grouped, and ordered by domain/myCalendar.ts. */
  dateGroups: readonly MyCalendarAgendaDateGroup[];
  yearMonth: string;
}

function itemId(item: MyCalendarAgendaItem): string {
  return item.kind === 'occurrence'
    ? item.occurrenceEntry.occurrence.id
    : item.scheduleEntry.entry.id;
}

/**
 * Month landing agenda. Each date heading uses the shared #189 role/text
 * authority, while each row delegates to MyCalendarEntryRow so the month
 * landing and selected-day detail share all item semantics.
 */
export function MyCalendarAgenda({ dateGroups, yearMonth }: MyCalendarAgendaProps) {
  return (
    <section className={styles.list} aria-label={`${yearMonth}の予定一覧`}>
      {dateGroups.map((group) => (
        <section
          key={group.date}
          aria-label={`${calendarDateAccessibleWeekdayLabel(group.date)}の予定`}
        >
          <DayRoleText as="h2" role={calendarDayRole(group.date)} className={styles.dateHeading}>
            {calendarDateWeekdayLabel(group.date)}
          </DayRoleText>
          <ul className={styles.items}>
            {group.items.map((item) => (
              <li
                key={`${item.kind}-${itemId(item)}`}
                className={styles.item}
                data-agenda-date={group.date}
                data-agenda-item-kind={item.kind}
                data-agenda-item-id={itemId(item)}
              >
                <MyCalendarEntryRow
                  item={item}
                  eventDetailContext={{ yearMonth, selectedDate: group.date }}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
