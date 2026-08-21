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

      {/* No ARIA grid/row/gridcell roles: those require a `grid`-rooted
          ancestor plus roving-tabindex arrow-key navigation to be valid,
          neither of which this bounded-tap-target month view implements.
          Each day is instead a plain, fully-labelled link (see
          dayAriaLabel below) - the accessible detail path for a day's full
          content is the selected-day list this link navigates to, not the
          visual month grid itself. */}
      <div>
        {viewModel.weeks.map((week, weekIndex) => {
          const maxLane = week.bandLayout.segments.reduce(
            (max, segment) => Math.max(max, segment.lane),
            -1,
          );
          return (
            // Weeks are a stable, never-reordered sequence within one
            // render, so the positional index is a safe React key here.
            <div key={weekIndex} className={styles.week}>
              {week.days.map((day, colIndex) => {
                const dayNumber = Number(day.date.slice(8, 10));
                const bandsThisDay = week.bandLayout.segments.filter(
                  (segment) => segment.startCol <= colIndex && colIndex <= segment.endCol,
                );
                const labelParts = [`${monthLabel(viewModel.yearMonth)}${String(dayNumber)}日`];
                if (day.date === todayDate) {
                  labelParts.push('今日');
                }
                if (bandsThisDay.length > 0) {
                  labelParts.push(bandsThisDay.map((segment) => segment.eventTitle).join('、'));
                }
                if (day.badgeCount > 0) {
                  labelParts.push(`ほか${String(day.badgeCount)}件`);
                }

                return (
                  <Link
                    key={day.date}
                    href={catalogDayHref(viewModel.yearMonth, day.date)}
                    aria-label={labelParts.join('、')}
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
                    <span aria-hidden="true">{dayNumber}</span>
                    {day.badgeCount > 0 ? (
                      <Badge variant="info" className={styles.badge} aria-hidden="true">
                        {day.badgeCount}
                      </Badge>
                    ) : null}
                  </Link>
                );
              })}

              {week.bandLayout.segments.map((segment) => (
                <span
                  key={`${segment.eventId}-${segment.startDate}`}
                  className={styles.band}
                  aria-hidden="true"
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
                <span className={styles.overflow} style={{ gridRow: maxLane + 3 }}>
                  {`この週にほか${String(week.bandLayout.overflowCount)}件 - 日付を選択すると確認できます`}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
