import Link from 'next/link';
import { LinkButton } from '@/ui/LinkButton';
import type { WeekBandLayout } from '@/domain/calendarMonth.ts';
import type { MyCalendarBandSegment, MyCalendarDayMarkers } from '@/domain/myCalendar.ts';
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
  /** One band layout per week, same order as `gridWeeks` (Issue #142:
   * multi-day Events/personal-schedule entries render as bands, following
   * the same rule and layout algorithm the Event Catalog's own MonthCalendar
   * uses - see domain/myCalendar.ts's buildMyCalendarWeekBandLayouts). */
  weekBandLayouts: readonly WeekBandLayout<MyCalendarBandSegment>[];
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

/** Issue #125/#123's own convention (see MonthCalendar.tsx's identical
 * helper): a band names a multi-day Event by title alone - append a
 * plain-text "（中止）" marker so a canceled Event's band and day
 * aria-label both carry the same distinguishable information. Personal-
 * schedule bands are never canceled (isCanceled is always false for
 * `kind: 'schedule'` - see buildMyCalendarScheduleBandSegments). */
function bandDisplayTitle(eventTitle: string, isCanceled: boolean): string {
  return isCanceled ? `${eventTitle}（中止）` : eventTitle;
}

/**
 * Weekday/holiday role -> color-role class (docs/ux-ui.md "Calendar weekday
 * / Japanese holiday presentation" + accessibility baseline: never
 * color-only) - same mapping as the Event Catalog's own roleClassName
 * (src/app/catalog/_components/MonthCalendar.tsx). No per-cell glyph any
 * more (Issue #142: 祝 glyph removed) - the role's non-color cue is the
 * weekday header + column position (Saturday/Sunday) and the day-number
 * weight/color pairing (holiday, see .roleHoliday in the CSS module).
 */
function roleClassName(role: MyCalendarDayMarkers['role']): string {
  if (role === 'holiday') {
    return styles.roleHoliday ?? '';
  }
  if (role === 'saturday') {
    return styles.roleSaturday ?? '';
  }
  if (role === 'sunday') {
    return styles.roleSunday ?? '';
  }
  return '';
}

export function MyMonthCalendar({
  yearMonth,
  gridWeeks,
  markersByDate,
  weekBandLayouts,
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
        {gridWeeks.map((week, weekIndex) => {
          const bandLayout = weekBandLayouts[weekIndex];
          return (
            // Weeks are a stable, never-reordered sequence within one render
            // (same convention as src/app/catalog/_components/MonthCalendar.tsx).
            <div key={weekIndex} className={styles.week}>
              {week.map((date, colIndex) => {
                const dayNumber = Number(date.slice(8, 10));
                const inCurrentMonth = date.slice(0, 7) === yearMonth;
                const markers = markersByDate.get(date);
                const bandsThisDay =
                  bandLayout?.segments.filter(
                    (segment) => segment.startCol <= colIndex && colIndex <= segment.endCol,
                  ) ?? [];

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
                if (bandsThisDay.length > 0) {
                  labelParts.push(
                    bandsThisDay
                      .map((segment) => bandDisplayTitle(segment.eventTitle, segment.isCanceled))
                      .join('、'),
                  );
                }

                return (
                  <Link
                    key={date}
                    href={myCalendarDayHref(yearMonth, date)}
                    aria-label={labelParts.join('、')}
                    aria-current={date === todayDate ? 'date' : undefined}
                    data-date={date}
                    style={{ gridColumn: colIndex + 1, gridRow: 1 }}
                    className={[
                      styles.day,
                      inCurrentMonth ? '' : styles.dayOutside,
                      date === selectedDate ? styles.daySelected : '',
                      markers ? roleClassName(markers.role) : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span className={styles.dayNumberRow} aria-hidden="true">
                      {/* "今日" is a gray filled circle around the day
                          number itself (Issue #142), distinct from
                          "選択中"'s own whole-cell ring (.daySelected
                          above) - the two combine without conflict since
                          they target different elements. */}
                      <span
                        className={[styles.dayNumber, date === todayDate ? styles.today : '']
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {dayNumber}
                      </span>
                    </span>
                    {markers && markers.dot !== 'none' ? (
                      <span className={styles.markerRow} aria-hidden="true">
                        <span
                          className={[
                            styles.dot,
                            markers.dot === 'filled' ? styles.dotFilled : styles.dotOutline,
                          ].join(' ')}
                        />
                      </span>
                    ) : null}
                  </Link>
                );
              })}

              {bandLayout?.segments.map((segment) => (
                <span
                  key={`${segment.eventId}-${segment.startDate}`}
                  className={[
                    styles.band,
                    segment.blocking ? styles.bandFilled : styles.bandOutline,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-hidden="true"
                  data-band-kind={segment.kind}
                  data-band-event-id={segment.eventId}
                  data-band-start-date={segment.startDate}
                  data-band-end-date={segment.endDate}
                  style={{
                    gridColumn: `${String(segment.startCol + 1)} / ${String(segment.endCol + 2)}`,
                    gridRow: segment.lane + 2,
                  }}
                  title={bandDisplayTitle(segment.eventTitle, segment.isCanceled)}
                >
                  {bandDisplayTitle(segment.eventTitle, segment.isCanceled)}
                </span>
              ))}

              {/* No overflow list (Issue #142: "1セルの marker は最大3...
                  溢れる分は表示しない"), matching the Event Catalog's own
                  MonthCalendar.tsx. Every day is still its own link above;
                  selecting any date this occurrence/schedule entry is
                  actually active on still surfaces it in the selected-day
                  list (MySelectedDayList.tsx) regardless of band-lane
                  coverage. */}
            </div>
          );
        })}
      </div>
    </section>
  );
}
