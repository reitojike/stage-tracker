import Link from 'next/link';
import { LinkButton } from '@/ui/LinkButton';
import type { MyCalendarDayMarkers } from '@/domain/myCalendar.ts';
import {
  myCalendarDayHref,
  myCalendarMonthHref,
  nextYearMonth,
  previousYearMonth,
} from '@/domain/myCalendarNavigation.ts';
import { participationStatusLabel } from '@/domain/myCalendarFormatting.ts';
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
 * accessibility baseline: never color-only).
 *
 * `text` is non-null only for holiday (Issue #102 -> #96 approved
 * direction): Saturday/Sunday's own per-cell text glyph is removed, their
 * non-color cue now carried by the weekday header + column position +
 * aria-label instead. `className` still applies to every weekend/holiday
 * role so the color cue itself (paired with those non-color cues) is
 * unchanged. Holiday's own `祝` glyph is kept - column position alone
 * cannot identify a holiday - and is still always rendered (not
 * aria-hidden-only) so the distinction survives without color.
 */
function roleMarker(
  role: MyCalendarDayMarkers['role'],
): { className: string; text: string | null } | null {
  if (role === 'holiday') {
    return { className: styles.roleHoliday ?? '', text: '祝' };
  }
  if (role === 'saturday') {
    return { className: styles.roleSaturday ?? '', text: null };
  }
  if (role === 'sunday') {
    return { className: styles.roleSunday ?? '', text: null };
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
    <section className={styles.calendar} aria-label={`${monthLabel(yearMonth)}のマイカレンダー`}>
      {/* No showPending={false} here (Issue #103, supersedes #102's
          opt-out): LinkButton's default LinkPending now provides the
          tapped control's pending feedback. The chevron glyph itself is
          wrapped so .monthNavButton's own CSS (below) can swap it for
          LinkPending's role="status" indicator via :has() rather than
          showing both at once - useLinkStatus's per-Link pending context
          is otherwise unchanged from #102. */}
      <div className={styles.header}>
        <LinkButton
          variant="icon"
          className={styles.monthNavButton}
          href={myCalendarMonthHref(previousYearMonth(yearMonth))}
          aria-label="前の月"
        >
          <span className={styles.navChevron} aria-hidden="true">
            ‹
          </span>
        </LinkButton>
        <p className={styles.monthLabel}>{monthLabel(yearMonth)}</p>
        <LinkButton
          variant="icon"
          className={styles.monthNavButton}
          href={myCalendarMonthHref(nextYearMonth(yearMonth))}
          aria-label="次の月"
        >
          <span className={styles.navChevron} aria-hidden="true">
            ›
          </span>
        </LinkButton>
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

      {hasUnconfirmedHolidayCoverage ? (
        // Non-color notice (text, not a color-only cue) - this month
        // includes at least one date the Japanese-holiday snapshot hasn't
        // confirmed one way or the other (see japaneseHolidaysData.ts's
        // coverage range). Month-level notice only (Issue #97 PO
        // adjudication supersedes Issue #34's per-cell marker/ARIA) - no
        // per-cell presentation names this to point back to. Ordered after
        // the weekday header (Issue #102: unified with the Event Catalog's
        // own MonthCalendar.tsx order - the unconditional structural
        // header comes first, this conditional advisory sits right before
        // the grid it qualifies).
        <p className={styles.coverageNotice} role="note">
          この月の一部の日付は祝日データの公表範囲外です。未公表の祝日は表示されません。
        </p>
      ) : null}

      <div className={styles.grid}>
        {gridWeeks.map((week, weekIndex) => (
          // Weeks are a stable, never-reordered sequence within one render
          // (same convention as src/app/catalog/_components/MonthCalendar.tsx).
          <div key={weekIndex} className={styles.week}>
            {week.map((date) => {
              const dayNumber = Number(date.slice(8, 10));
              const inCurrentMonth = date.slice(0, 7) === yearMonth;
              const markers = markersByDate.get(date);
              const marker = markers ? roleMarker(markers.role) : null;
              // markersByDate has an entry for every displayed date (not just
              // ones with something to show), so `markers` alone is not a
              // reliable "is there anything to render" signal - without this,
              // every ordinary weekday would reserve the marker row's
              // min-height for nothing, unlike MonthCalendar.tsx's own
              // hasMarkerRow guard for the same #96 -> #102 marker row.
              const hasMarkerRow =
                Boolean(marker?.text) ||
                (markers !== undefined &&
                  (markers.attendingCount > 0 ||
                    markers.consideringCount > 0 ||
                    markers.hasUnconfirmedTicket ||
                    markers.ownScheduleCount > 0 ||
                    markers.sharedScheduleCount > 0));

              // Lead/trail cells (inCurrentMonth === false) belong to an
              // adjacent month - their own date's month, never the
              // displayed yearMonth, so the aria-label doesn't announce a
              // mismatched month for those cells (e.g. an August grid's
              // trailing "2026-09-01" cell must read as 9月, not 8月).
              const labelParts = [`${monthLabel(date.slice(0, 7))}${String(dayNumber)}日`];
              if (date === todayDate) {
                labelParts.push('今日');
              }
              if (markers?.role === 'holiday') {
                labelParts.push('祝日');
              } else if (markers?.role === 'saturday') {
                labelParts.push('土曜日');
              } else if (markers?.role === 'sunday') {
                labelParts.push('日曜日');
              }
              if (markers && markers.attendingCount > 0) {
                labelParts.push(
                  `${participationStatusLabel('attending')}公演${String(markers.attendingCount)}件`,
                );
              }
              if (markers && markers.consideringCount > 0) {
                labelParts.push(
                  `${participationStatusLabel('considering')}公演${String(markers.consideringCount)}件`,
                );
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
                  </span>
                  {markers && hasMarkerRow ? (
                    <span className={styles.markerRow} aria-hidden="true">
                      {marker?.text ? (
                        <span className={styles.dayRoleMark}>{marker.text}</span>
                      ) : null}
                      {markers.attendingCount > 0 ? (
                        <span
                          className={styles.markerAttending}
                          title={participationStatusLabel('attending')}
                        >
                          ●{markers.attendingCount > 1 ? markers.attendingCount : ''}
                        </span>
                      ) : null}
                      {markers.consideringCount > 0 ? (
                        <span
                          className={styles.markerConsidering}
                          title={participationStatusLabel('considering')}
                        >
                          ？{markers.consideringCount > 1 ? markers.consideringCount : ''}
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
