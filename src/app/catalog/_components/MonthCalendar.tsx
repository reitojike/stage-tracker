import Link from 'next/link';
import { Badge } from '@/ui/Badge';
import { LinkButton } from '@/ui/LinkButton';
import type { CalendarDayRole } from '@/domain/calendarDayRole.ts';
import type { MonthCalendarViewModel } from '@/domain/calendarMonth.ts';
import {
  catalogDayHref,
  catalogEventHref,
  catalogMonthHref,
  nextYearMonth,
  previousYearMonth,
  type CatalogParams,
} from '@/domain/catalogNavigation.ts';
import styles from './MonthCalendar.module.css';

export interface MonthCalendarProps {
  viewModel: MonthCalendarViewModel;
  selectedDate: string | null;
  todayDate: string;
  /** Carried through to each overflow event's link (see the overflow
   * rendering below), so following one returns to the same month/day
   * context the surrounding screens navigate with. */
  context: CatalogParams;
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
 *
 * `text` is non-null only for holiday (Issue #102 -> #96 approved
 * direction): Saturday/Sunday's own per-cell text glyph is removed, their
 * non-color cue now carried by the weekday header + column position +
 * aria-label instead. `className` still applies to every weekend/holiday
 * role so the color cue itself (paired with those non-color cues) is
 * unchanged. Holiday's own `祝` glyph is kept - column position alone
 * cannot identify a holiday.
 */
function roleMarker(role: CalendarDayRole): { className: string; text: string | null } | null {
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

export function MonthCalendar({ viewModel, selectedDate, todayDate, context }: MonthCalendarProps) {
  return (
    <section
      className={styles.calendar}
      aria-label={`${monthLabel(viewModel.yearMonth)}のイベントカレンダー`}
    >
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
          href={catalogMonthHref(previousYearMonth(viewModel.yearMonth))}
          aria-label="前の月"
        >
          <span className={styles.navChevron} aria-hidden="true">
            ‹
          </span>
        </LinkButton>
        <p className={styles.monthLabel}>{monthLabel(viewModel.yearMonth)}</p>
        <LinkButton
          variant="icon"
          className={styles.monthNavButton}
          href={catalogMonthHref(nextYearMonth(viewModel.yearMonth))}
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

      {viewModel.hasUnconfirmedHolidayCoverage ? (
        // Non-color notice (text, not a color-only cue) - same convention
        // as My Calendar's own coverageNotice
        // (src/app/calendar/_components/MyMonthCalendar.tsx): at least one
        // date this month falls outside the Japanese-holiday snapshot's
        // confirmed coverage. Month-level notice only (Issue #97 PO
        // adjudication supersedes Issue #34's per-cell marker/ARIA) - no
        // per-cell presentation names this to point back to.
        <p className={styles.coverageNotice} role="note">
          この月の一部の日付は祝日データの公表範囲外です。未公表の祝日は表示されません。
        </p>
      ) : null}

      {/* No ARIA grid/row/gridcell roles: those require a `grid`-rooted
          ancestor plus roving-tabindex arrow-key navigation to be valid,
          neither of which this bounded-tap-target month view implements.
          Each day is instead a plain, fully-labelled link (see
          dayAriaLabel below) - the accessible detail path for a day's full
          content is the selected-day list this link navigates to, not the
          visual month grid itself. */}
      <div className={styles.grid}>
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
                const hasMarkerRow = Boolean(marker?.text) || day.badgeCount > 0;
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
                  // Never the same Events named in bandsThisDay above
                  // (Issue #91 PO decision): bandsThisDay is multi-day
                  // Events only, badgeCount is a single-day Event count
                  // only. "ほか" ("besides the band(s) above") only reads
                  // sensibly when a band was actually named first - a day
                  // with single-day Events and no multi-day band passing
                  // through it (bandsThisDay empty) needs a label that
                  // stands on its own instead.
                  labelParts.push(
                    bandsThisDay.length > 0
                      ? `ほか${String(day.badgeCount)}件`
                      : `イベント${String(day.badgeCount)}件`,
                  );
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
                    </span>
                    {hasMarkerRow ? (
                      <span className={styles.markerRow} aria-hidden="true">
                        {marker?.text ? (
                          <span className={styles.dayRoleMark}>{marker.text}</span>
                        ) : null}
                        {day.badgeCount > 0 ? (
                          <Badge variant="info" className={styles.badge}>
                            {day.badgeCount}
                          </Badge>
                        ) : null}
                      </span>
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

              {week.bandLayout.overflowEvents.length > 0 ? (
                // Links directly to each overflowing event, not just a
                // count with a "select a date" hint: since Issue #91 a
                // band covers its whole Event range regardless of
                // occurrence evidence, an event can overflow a week where
                // it has no occurrence at all (its occurrences fall in a
                // different week of the same range) - no day selection
                // within this week would ever surface it via
                // selectDayOccurrences, so the link here is this week's
                // only reachable path to it.
                <p className={styles.overflow} style={{ gridRow: maxLane + 3 }}>
                  {`この週にほか${String(week.bandLayout.overflowEvents.length)}件：`}
                  {week.bandLayout.overflowEvents.map((overflowEvent, index) => (
                    <span key={overflowEvent.eventId}>
                      {index > 0 ? '、' : ''}
                      <Link
                        href={catalogEventHref(overflowEvent.eventId, context)}
                        className={styles.overflowLink}
                      >
                        {overflowEvent.eventTitle}
                      </Link>
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
