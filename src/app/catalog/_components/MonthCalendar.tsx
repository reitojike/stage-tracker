import Link from 'next/link';
import { Badge } from '@/ui/Badge';
import type { CalendarDayRole } from '@/domain/calendarDayRole.ts';
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

/**
 * Weekday/holiday role -> a (color-role class, short non-color marker) pair
 * (docs/ux-ui.md "Calendar weekday / Japanese holiday presentation" +
 * accessibility baseline: never color-only) - same mapping as My Calendar's
 * own roleMarker (src/app/calendar/_components/MyMonthCalendar.tsx), reused
 * here rather than re-adjudicated, per Issue #72 ("My Calendar側の既存
 * behaviorをauthorityとしてreuse").
 */
function roleMarker(role: CalendarDayRole): { className: string; text: string } | null {
  if (role === 'holiday') {
    return { className: styles.roleHoliday ?? '', text: '祝' };
  }
  if (role === 'saturday') {
    return { className: styles.roleSaturday ?? '', text: '土' };
  }
  if (role === 'sunday') {
    return { className: styles.roleSunday ?? '', text: '日' };
  }
  return null;
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
        {WEEKDAY_LABELS.map((label, index) => (
          <span
            key={label}
            className={[
              styles.weekday,
              index === 6 ? styles.roleSaturday : '',
              index === 0 ? styles.roleSunday : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {label}
          </span>
        ))}
      </div>

      {viewModel.hasUnconfirmedHolidayCoverage ? (
        // Non-color notice (text, not a color-only cue) - same convention
        // as My Calendar's own coverageNotice
        // (src/app/calendar/_components/MyMonthCalendar.tsx): at least one
        // date this month falls outside the Japanese-holiday snapshot's
        // confirmed coverage, so holiday presentation for those dates is
        // marked "祝日未確認" per-cell below rather than silently shown as
        // an ordinary/confirmed-non-holiday day.
        <p className={styles.coverageNotice} role="note">
          この月の一部の日付は祝日データの公表範囲外のため、祝日表示が未確認です（「祝日未確認」の日付を参照）。
        </p>
      ) : null}

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
                const marker = roleMarker(day.role);
                // Lead/trail cells (inCurrentMonth === false) belong to an
                // adjacent month - their own date's month, never the
                // displayed viewModel.yearMonth, so the aria-label doesn't
                // announce a mismatched month for those cells (same
                // convention as MyMonthCalendar.tsx's labelParts).
                const labelParts = [`${monthLabel(day.date.slice(0, 7))}${String(dayNumber)}日`];
                if (day.date === todayDate) {
                  labelParts.push('今日');
                }
                if (day.role === 'holiday') {
                  labelParts.push('祝日');
                } else if (day.role === 'saturday') {
                  labelParts.push('土曜日');
                } else if (day.role === 'sunday') {
                  labelParts.push('日曜日');
                }
                if (bandsThisDay.length > 0) {
                  labelParts.push(bandsThisDay.map((segment) => segment.eventTitle).join('、'));
                }
                if (day.badgeCount > 0) {
                  labelParts.push(`ほか${String(day.badgeCount)}件`);
                }
                if (!day.holidayDataConfirmed) {
                  // Accessibility baseline (calendarDayRole.ts's header): an
                  // out-of-coverage date must not be presentation-equivalent
                  // to a confirmed ordinary day - same convention as My
                  // Calendar's own "祝日未確認" labeling.
                  labelParts.push('祝日未確認');
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
                      marker ? marker.className : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span className={styles.dayNumberRow} aria-hidden="true">
                      <span>{dayNumber}</span>
                      {marker ? <span className={styles.dayRoleMark}>{marker.text}</span> : null}
                      {!day.holidayDataConfirmed ? (
                        <span
                          className={styles.markerHolidayUnconfirmed}
                          title="祝日データ公表範囲外（祝日未確認）"
                        >
                          ?
                        </span>
                      ) : null}
                    </span>
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
