import Link from 'next/link';
import { LinkButton } from '@/ui/LinkButton';
import type { CalendarDayRole } from '@/domain/calendarDayRole.ts';
import type { MonthCalendarViewModel } from '@/domain/calendarMonth.ts';
import { MAX_BAND_LANES } from '@/domain/calendarMonth.ts';
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
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function monthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  return `${year ?? yearMonth}年${String(Number(month ?? '1'))}月`;
}

/** Issue #125/#123: a band names a multi-day Event by title alone
 * elsewhere in this component - this appends a plain-text "（中止）" marker
 * (not color-only, consistent with this file's other non-color cues) so a
 * canceled Event's band and day aria-label both carry the same
 * distinguishable information. */
function bandDisplayTitle(eventTitle: string, isCanceled: boolean): string {
  return isCanceled ? `${eventTitle}（中止）` : eventTitle;
}

/**
 * Weekday/holiday role -> color-role class (docs/ux-ui.md "Calendar weekday
 * / Japanese holiday presentation" + accessibility baseline: never
 * color-only) - same mapping as My Calendar's own roleClassName
 * (src/app/calendar/_components/MyMonthCalendar.tsx), reused here rather
 * than re-adjudicated, per Issue #72 ("My Calendar側の既存behaviorを
 * authorityとしてreuse"). The role's own non-color cue is the weekday
 * header + column position (Saturday/Sunday) and the day-number weight/color
 * pairing (holiday, Issue #142 - see .roleHoliday below); no per-cell glyph
 * any more (`祝` is removed, Issue #142: "祝グリフは廃止").
 */
function roleClassName(role: CalendarDayRole): string {
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

export function MonthCalendar({ viewModel, selectedDate, todayDate }: MonthCalendarProps) {
  // Same CatalogParams shape catalogEventHref's other Event Catalog callers
  // (EventLevelFallbackList/SelectedDayList) build from - lets the week
  // overflow summary link land back on this exact month/selected-day
  // context instead of a bare event detail page (Issue #176).
  const catalogContext: CatalogParams = { yearMonth: viewModel.yearMonth, selectedDate };

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
          return (
            // Weeks are a stable, never-reordered sequence within one
            // render, so the positional index is a safe React key here.
            <div key={weekIndex} className={styles.week}>
              {week.days.map((day, colIndex) => {
                const dayNumber = Number(day.date.slice(8, 10));
                const bandsThisDay = week.bandLayout.segments.filter(
                  (segment) => segment.startCol <= colIndex && colIndex <= segment.endCol,
                );
                // A single-day Event is represented by exactly one dot
                // regardless of how many such Events fall on this date
                // (Issue #142: "dot は1セル1個") - catalog Events carry no
                // considering/blocking axis of their own (that is a
                // per-user participation concept, out of this component's
                // scope), so the dot is always filled.
                const hasDot = day.badgeCount > 0;
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
                  labelParts.push(
                    bandsThisDay
                      .map((segment) => bandDisplayTitle(segment.eventTitle, segment.isCanceled))
                      .join('、'),
                  );
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
                      day.date === selectedDate ? styles.daySelected : '',
                      roleClassName(day.role),
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
                        className={[styles.dayNumber, day.date === todayDate ? styles.today : '']
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {dayNumber}
                      </span>
                    </span>
                    {hasDot ? (
                      <span className={styles.markerRow} aria-hidden="true">
                        <span
                          className={[styles.dot, styles.dotFilled].filter(Boolean).join(' ')}
                        />
                      </span>
                    ) : null}
                  </Link>
                );
              })}

              {week.bandLayout.segments.map((segment) => (
                <span
                  key={`${segment.eventId}-${segment.startDate}`}
                  // Catalog Events carry no per-user considering/blocking
                  // axis (see hasDot's comment above), so every band is the
                  // filled/confirmed style (Issue #142's band fill/outline
                  // axis only applies where that axis exists - My
                  // Calendar's own bands, see MyMonthCalendar.tsx).
                  className={[styles.band, styles.bandFilled].filter(Boolean).join(' ')}
                  aria-hidden="true"
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

              {/* Issue #142 removed the full per-hidden-event overflow list
                  (still true here: no per-title listing, no third band
                  lane) but Issue #176 restores a *compact* existence/count
                  disclosure so a week with 3+ concurrent multi-day Events
                  doesn't read identically to one with exactly 2. This reuses
                  week.bandLayout.overflowEvents/overflowCount as-is (already
                  deduplicated by eventId - see layoutWeekBands in
                  calendarMonth.ts) rather than re-deriving which Events are
                  hidden; the 2-band lane cap itself (MAX_BAND_LANES) is
                  unchanged. */}
              {week.bandLayout.overflowEvents.length > 0
                ? (() => {
                    const firstHidden = week.bandLayout.overflowEvents[0];
                    if (firstHidden === undefined) {
                      return null;
                    }
                    const firstHiddenTitle = bandDisplayTitle(
                      firstHidden.eventTitle,
                      firstHidden.isCanceled,
                    );
                    return (
                      <p
                        className={styles.weekOverflow}
                        style={{ gridColumn: '1 / -1', gridRow: MAX_BAND_LANES + 2 }}
                      >
                        {/* Visible text (never color-only) carries the
                            count; the truncated title stays fully present
                            in the DOM/accessible name even where CSS
                            ellipsis clips it visually - see .weekOverflow /
                            .weekOverflowLink below. */}
                        <span className={styles.weekOverflowLabel}>
                          {`この週にほか${String(week.bandLayout.overflowCount)}件：`}
                        </span>
                        <Link
                          href={catalogEventHref(firstHidden.eventId, catalogContext)}
                          className={styles.weekOverflowLink}
                          title={firstHiddenTitle}
                        >
                          {firstHiddenTitle}
                        </Link>
                      </p>
                    );
                  })()
                : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
