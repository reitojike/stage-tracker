import Link from 'next/link';
import { Badge } from '@/ui/Badge';
import type { MonthCalendarViewModel } from '@/domain/calendarMonth.ts';
import {
  catalogDayHref,
  catalogMonthHref,
  nextYearMonth,
  previousYearMonth,
} from '@/domain/catalogNavigation.ts';
import styles from './MonthCalendar.module.css';

export interface MonthCalendarProps {
  viewModel: MonthCalendarViewModel;
  selectedDate: string | null;
  todayDate: string;
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function monthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  return `${year ?? yearMonth}年${String(Number(month ?? '1'))}月`;
}

export function MonthCalendar({ viewModel, selectedDate, todayDate }: MonthCalendarProps) {
  return (
    <section
      className={styles.calendar}
      aria-label={`${monthLabel(viewModel.yearMonth)}のイベントカレンダー`}
    >
      <div className={styles.header}>
        <Link
          className={styles.navLink}
          href={catalogMonthHref(previousYearMonth(viewModel.yearMonth))}
          aria-label="前の月"
        >
          ‹
        </Link>
        <p className={styles.monthLabel}>{monthLabel(viewModel.yearMonth)}</p>
        <Link
          className={styles.navLink}
          href={catalogMonthHref(nextYearMonth(viewModel.yearMonth))}
          aria-label="次の月"
        >
          ›
        </Link>
      </div>

      <div className={styles.weekdayRow} aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} className={styles.weekday}>
            {label}
          </span>
        ))}
      </div>

      <div role="rowgroup">
        {viewModel.weeks.map((week, weekIndex) => {
          const maxLane = week.bandLayout.segments.reduce(
            (max, segment) => Math.max(max, segment.lane),
            -1,
          );
          return (
            // Weeks are a stable, never-reordered sequence within one
            // render, so the positional index is a safe React key here.
            <div key={weekIndex} className={styles.week} role="row">
              {week.days.map((day, colIndex) => (
                <Link
                  key={day.date}
                  href={catalogDayHref(viewModel.yearMonth, day.date)}
                  role="gridcell"
                  aria-current={day.date === todayDate ? 'date' : undefined}
                  data-date={day.date}
                  data-badge-count={day.badgeCount}
                  style={{ gridColumn: colIndex + 1, gridRow: 1 }}
                  className={[
                    styles.day,
                    day.inCurrentMonth ? '' : styles.dayOutside,
                    day.date === todayDate ? styles.dayToday : '',
                    day.date === selectedDate ? styles.daySelected : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span>{Number(day.date.slice(8, 10))}</span>
                  {day.badgeCount > 0 ? (
                    <Badge variant="info" className={styles.badge}>
                      {day.badgeCount}
                    </Badge>
                  ) : null}
                </Link>
              ))}

              {week.bandLayout.segments.map((segment) => (
                <span
                  key={`${segment.eventId}-${segment.startDate}`}
                  className={styles.band}
                  data-band-event-id={segment.eventId}
                  data-band-start-date={segment.startDate}
                  data-band-end-date={segment.endDate}
                  style={{
                    gridColumn: `${String(segment.startCol + 1)} / ${String(segment.endCol + 2)}`,
                    gridRow: segment.lane + 2,
                  }}
                  title={segment.eventTitle}
                >
                  {segment.eventTitle}
                </span>
              ))}

              {week.bandLayout.overflowCount > 0 ? (
                <span
                  className={styles.overflow}
                  style={{ gridRow: maxLane + 3 }}
                >{`ほか${String(week.bandLayout.overflowCount)}件`}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
