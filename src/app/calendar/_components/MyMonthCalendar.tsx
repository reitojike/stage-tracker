import Link from 'next/link';
import type { MyCalendarDayMarkers } from '@/domain/myCalendar.ts';
import {
  myCalendarDayHref,
  myCalendarMonthHref,
  nextYearMonth,
  previousYearMonth,
} from '@/domain/myCalendarNavigation.ts';
import styles from './MyMonthCalendar.module.css';

export interface MyMonthCalendarProps {
  yearMonth: string;
  /** All displayed dates, week by week (calendarMonth.buildMonthGrid's own
   * MonthGrid.weeks - includes lead/trail days from adjacent months). */
  gridWeeks: readonly (readonly string[])[];
  markersByDate: ReadonlyMap<string, MyCalendarDayMarkers>;
  selectedDate: string | null;
  todayDate: string;
  /** True when any date actually inside `yearMonth` falls outside the
   * Japanese-holiday snapshot's confirmed coverage range (page.tsx
   * computes this from each marker's `holidayDataConfirmed`). Drives a
   * month-level non-color notice - see the accessibility baseline in
   * calendarDayRole.ts's header: color is never the sole carrier of
   * meaning, and an unconfirmed date must not be presentation-equivalent
   * to a confirmed ordinary day. */
  hasUnconfirmedHolidayCoverage: boolean;
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function monthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  return `${year ?? yearMonth}年${String(Number(month ?? '1'))}月`;
}

/**
 * Weekday/holiday role -> a (color-role class, short non-color marker) pair
 * (docs/ux-ui.md "Calendar weekday / Japanese holiday presentation" +
 * accessibility baseline: never color-only). The marker text is always
 * rendered (not aria-hidden-only) so the distinction survives without
 * color, e.g. for a colorblind reader or a printed/high-contrast override.
 */
function roleMarker(
  role: MyCalendarDayMarkers['role'],
): { className: string; text: string } | null {
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

export function MyMonthCalendar({
  yearMonth,
  gridWeeks,
  markersByDate,
  selectedDate,
  todayDate,
  hasUnconfirmedHolidayCoverage,
}: MyMonthCalendarProps) {
  return (
    <section className={styles.calendar} aria-label={`${monthLabel(yearMonth)}のMy Calendar`}>
      <div className={styles.header}>
        <Link
          className={styles.navLink}
          href={myCalendarMonthHref(previousYearMonth(yearMonth))}
          aria-label="前の月"
        >
          ‹
        </Link>
        <p className={styles.monthLabel}>{monthLabel(yearMonth)}</p>
        <Link
          className={styles.navLink}
          href={myCalendarMonthHref(nextYearMonth(yearMonth))}
          aria-label="次の月"
        >
          ›
        </Link>
      </div>

      {hasUnconfirmedHolidayCoverage ? (
        // Non-color notice (text, not a color-only cue) - this month
        // includes at least one date the Japanese-holiday snapshot hasn't
        // confirmed one way or the other (see japaneseHolidaysData.ts's
        // coverage range), so holiday presentation for those dates is
        // marked "祝日未確認" per-cell below rather than silently shown as
        // an ordinary/confirmed-non-holiday day.
        <p className={styles.coverageNotice} role="note">
          この月の一部の日付は祝日データの公表範囲外のため、祝日表示が未確認です（「祝日未確認」の日付を参照）。
        </p>
      ) : null}

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

      <div>
        {gridWeeks.map((week, weekIndex) => (
          // Weeks are a stable, never-reordered sequence within one render
          // (same convention as src/app/catalog/_components/MonthCalendar.tsx).
          <div key={weekIndex} className={styles.week}>
            {week.map((date) => {
              const dayNumber = Number(date.slice(8, 10));
              const inCurrentMonth = date.slice(0, 7) === yearMonth;
              const markers = markersByDate.get(date);
              const marker = markers ? roleMarker(markers.role) : null;

              // Lead/trail cells (inCurrentMonth === false) belong to an
              // adjacent month - their own date's month, never the
              // displayed yearMonth, so the aria-label doesn't announce a
              // mismatched month for those cells (e.g. an August grid's
              // trailing "2026-09-01" cell must read as 9月, not 8月).
              const labelParts = [`${monthLabel(date.slice(0, 7))}${String(dayNumber)}日`];
              if (date === todayDate) {
                labelParts.push('今日');
              }
              if (marker && markers?.role === 'holiday') {
                labelParts.push(marker.text === '祝' ? '祝日' : marker.text);
              } else if (markers?.role === 'saturday') {
                labelParts.push('土曜日');
              } else if (markers?.role === 'sunday') {
                labelParts.push('日曜日');
              }
              if (markers && markers.occurrenceCount > 0) {
                labelParts.push(`公演${String(markers.occurrenceCount)}件`);
              }
              if (markers?.hasUnconfirmedTicket) {
                labelParts.push('チケット未確定あり');
              }
              if (markers && markers.ownScheduleCount > 0) {
                labelParts.push(`自分の予定${String(markers.ownScheduleCount)}件`);
              }
              if (markers && markers.sharedScheduleCount > 0) {
                labelParts.push(`共有された予定${String(markers.sharedScheduleCount)}件`);
              }
              if (markers && !markers.holidayDataConfirmed) {
                // Accessibility baseline (calendarDayRole.ts's header):
                // an out-of-coverage date must not be
                // presentation-equivalent to a confirmed ordinary day, so
                // this survives even without the .markerHolidayUnconfirmed
                // badge's own color/border cue.
                labelParts.push('祝日未確認');
              }

              return (
                <Link
                  key={date}
                  href={myCalendarDayHref(yearMonth, date)}
                  aria-label={labelParts.join('、')}
                  aria-current={date === todayDate ? 'date' : undefined}
                  data-date={date}
                  className={[
                    styles.day,
                    inCurrentMonth ? '' : styles.dayOutside,
                    date === todayDate ? styles.dayToday : '',
                    date === selectedDate ? styles.daySelected : '',
                    marker ? marker.className : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className={styles.dayNumberRow} aria-hidden="true">
                    <span>{dayNumber}</span>
                    {marker ? <span className={styles.dayRoleMark}>{marker.text}</span> : null}
                  </span>
                  {markers ? (
                    <span className={styles.markerRow} aria-hidden="true">
                      {markers.occurrenceCount > 0 ? (
                        <span className={styles.markerOccurrence} title="参加登録した公演">
                          ●{markers.occurrenceCount > 1 ? markers.occurrenceCount : ''}
                        </span>
                      ) : null}
                      {markers.hasUnconfirmedTicket ? (
                        <span className={styles.markerTicket} title="チケット未確定">
                          !
                        </span>
                      ) : null}
                      {markers.ownScheduleCount > 0 ? (
                        <span className={styles.markerScheduleOwn} title="自分の予定">
                          予
                        </span>
                      ) : null}
                      {markers.sharedScheduleCount > 0 ? (
                        <span className={styles.markerScheduleShared} title="共有された予定">
                          共
                        </span>
                      ) : null}
                      {!markers.holidayDataConfirmed ? (
                        <span
                          className={styles.markerHolidayUnconfirmed}
                          title="祝日データ公表範囲外（祝日未確認）"
                        >
                          ?
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
