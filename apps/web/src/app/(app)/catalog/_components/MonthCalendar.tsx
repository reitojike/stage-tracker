import Link from "next/link";
import type { TokyoCalendarDate } from "@stage-tracker/domain";
import { cn } from "cn";
import {
  tokyoYearMonthOf,
  weekdayLabelJa,
  type TokyoYearMonth,
} from "@/app/_lib/calendar-grid";
import { MAX_BAND_LANES } from "@/app/_lib/calendar-band-layout";
import type { CalendarDayRole } from "@/app/_lib/calendar-day-role";
import type { MonthCalendarViewModel } from "../_lib/calendar-view-model";
import { catalogDayHref, catalogEventHref } from "../_lib/catalog-links";

export interface MonthCalendarProps {
  readonly viewModel: MonthCalendarViewModel;
  readonly selectedDate: TokyoCalendarDate | null;
  readonly today: TokyoCalendarDate;
}

/** Issue #125/#123 (ported): a band names a multi-day Event by title alone
 * elsewhere in this component - this appends a plain-text "（中止）" marker
 * (not color-only) so a canceled Event's band and its day's aria-label both
 * carry the same distinguishable information
 * (AGENTS.md "Cancellation": "UIでは中止状態が「中止」として表示されます"). */
function bandDisplayTitle(eventTitle: string, isCanceled: boolean): string {
  return isCanceled ? `${eventTitle}（中止）` : eventTitle;
}

/** Weekday/holiday role -> non-today text color class (accessibility
 * baseline: never color-only - each role's own text/aria-label always
 * carries the role as visible/accessible text too, see labelParts below and
 * the weekday header's own glyph). */
function roleTextClassName(role: CalendarDayRole): string | undefined {
  if (role === "holiday") {
    return "text-calendar-holiday font-semibold";
  }
  if (role === "saturday") {
    return "text-calendar-saturday";
  }
  if (role === "sunday") {
    return "text-calendar-sunday";
  }
  return undefined;
}

function monthLabel(month: TokyoYearMonth): string {
  return `${String(month.year)}年${String(month.month)}月`;
}

/**
 * `/catalog`'s month calendar grid, ported from
 * `apps/legacy-web/src/app/catalog/_components/MonthCalendar.tsx`
 * (`docs/v2/oracle-domain.md` §2.9/§2.10/§2.11). Renders multi-day Event
 * bands (capped at `MAX_BAND_LANES` lanes/week, with a per-week overflow
 * summary), single-day Event dot/count badges, weekday/holiday role
 * coloring, and the month-level unconfirmed-holiday-coverage notice.
 *
 * Uses inline `style` for the computed `gridColumn`/`gridRow` band
 * placement (dynamic values Tailwind's static utility classes cannot
 * express), the same technique the legacy component this ports used with
 * its own CSS Grid - everything else uses ordinary Tailwind utility
 * classes, following this app's existing convention
 * (`(app)/calendar/_components/CalendarView.tsx`'s own `MonthGrid`).
 *
 * A day that is both "今日" and a weekday/holiday role: this component
 * gives the existing "今日" filled-circle treatment (already shipped for My
 * Calendar's own month grid, `CalendarView.tsx`) visual precedence over the
 * role's text color, since a day cell's aria-label always states the role
 * as text regardless (see labelParts below) - the accessibility baseline
 * ("色のみで判断させない") is satisfied by that non-color channel, not by
 * the visual color itself.
 */
export function MonthCalendar({
  viewModel,
  selectedDate,
  today,
}: MonthCalendarProps) {
  const weekdayHeaderDates = viewModel.weeks[0]?.days.map((d) => d.date) ?? [];

  return (
    <section
      className="flex flex-col gap-sm"
      aria-label={`${monthLabel(viewModel.month)}のイベントカレンダー`}
    >
      <div
        className="grid grid-cols-7 gap-2xs text-center text-caption font-semibold text-muted-foreground"
        aria-hidden="true"
      >
        {weekdayHeaderDates.map((date, index) => (
          <span
            key={date}
            className={cn(
              "py-2xs",
              index === 6 ? "text-calendar-saturday" : undefined,
              index === 0 ? "text-calendar-sunday" : undefined,
            )}
          >
            {weekdayLabelJa(date)}
          </span>
        ))}
      </div>

      {viewModel.hasUnconfirmedHolidayCoverage ? (
        <p
          role="note"
          className="rounded-control border border-dashed border-border p-xs text-caption text-muted-foreground"
        >
          この月の一部の日付は祝日データの公表範囲外です。未公表の祝日は表示されません。
        </p>
      ) : null}

      {/* No ARIA grid/row/gridcell roles (codex review 指摘, ported from
          legacy's own MonthCalendar.tsx comment): those require a
          grid-rooted ancestor plus roving-tabindex arrow-key navigation to
          be valid, neither of which this bounded-tap-target month view
          implements. Each day is instead a plain, fully-labelled Link (see
          labelParts above) - the accessible detail path for a day's full
          content is the selected-day list this link navigates to, not the
          visual month grid itself. */}
      <div className="flex flex-col gap-2xs">
        {viewModel.weeks.map((week, weekIndex) => {
          const overflowEvents = week.bandLayout.overflowEvents;

          return (
            <div
              key={weekIndex}
              className="relative grid grid-cols-7 gap-2xs border-t border-border pt-2xs [grid-auto-rows:minmax(0,min-content)]"
            >
              {week.days.map((day, colIndex) => {
                const dayNumber = Number(day.date.slice(8, 10));
                const bandsThisDay = week.bandLayout.segments.filter(
                  (segment) =>
                    segment.startCol <= colIndex && colIndex <= segment.endCol,
                );
                const hasDot = day.badgeCount > 0;
                const isToday = day.date === today;
                const isSelected = day.date === selectedDate;

                const cellMonth = tokyoYearMonthOf(day.date);
                const labelParts = [
                  `${monthLabel(cellMonth)}${String(dayNumber)}日`,
                ];
                if (isToday) {
                  labelParts.push("今日");
                }
                if (day.role === "holiday") {
                  labelParts.push("祝日");
                } else if (day.role === "saturday") {
                  labelParts.push("土曜日");
                } else if (day.role === "sunday") {
                  labelParts.push("日曜日");
                }
                if (bandsThisDay.length > 0) {
                  labelParts.push(
                    bandsThisDay
                      .map((segment) =>
                        bandDisplayTitle(
                          segment.eventTitle,
                          segment.isCanceled,
                        ),
                      )
                      .join("、"),
                  );
                }
                if (day.badgeCount > 0) {
                  labelParts.push(
                    bandsThisDay.length > 0
                      ? `ほか${String(day.badgeCount)}件`
                      : `イベント${String(day.badgeCount)}件`,
                  );
                }

                return (
                  <Link
                    key={day.date}
                    href={catalogDayHref(day.date)}
                    aria-label={labelParts.join("、")}
                    // `aria-current="date"` marks *today* within a
                    // collection of dates (WAI-ARIA `aria-current` value
                    // "date"'s own definition) - it is not a "selected"
                    // indicator. The visual/selected state below
                    // (`isSelected` -> `border-primary bg-muted`) is a
                    // separate, non-ARIA-current concern, matching legacy's
                    // own MonthCalendar.tsx (`aria-current` on `todayDate`)
                    // and My Calendar's oracle (`docs/v2/oracle-domain.md`
                    // §2.9). A prior revision of this file matched v2's
                    // existing `/calendar` `CalendarView.tsx` instead (which
                    // puts `aria-current` on the selected day) - that is
                    // itself the same misuse, tracked separately for the My
                    // Calendar parity fix rather than repeated here.
                    aria-current={isToday ? "date" : undefined}
                    data-date={day.date}
                    style={{ gridColumn: colIndex + 1, gridRow: 1 }}
                    className={cn(
                      "flex min-h-11 flex-col items-center gap-2xs rounded-control-sm border border-transparent p-xs text-body-sm",
                      day.inCurrentMonth
                        ? "text-foreground"
                        : "text-muted-foreground",
                      isSelected ? "border-primary bg-muted" : "hover:bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-6 items-center justify-center rounded-pill",
                        isToday
                          ? "bg-primary font-medium text-primary-foreground"
                          : roleTextClassName(day.role),
                      )}
                    >
                      {dayNumber}
                    </span>
                    {hasDot ? (
                      <span
                        aria-hidden="true"
                        className="flex h-2 items-center"
                      >
                        <span className="size-1 rounded-pill bg-primary" />
                      </span>
                    ) : null}
                  </Link>
                );
              })}

              {week.bandLayout.segments.map((segment) => (
                <span
                  key={`${segment.eventId}-${segment.startDate}`}
                  aria-hidden="true"
                  data-band-event-id={segment.eventId}
                  title={bandDisplayTitle(
                    segment.eventTitle,
                    segment.isCanceled,
                  )}
                  style={{
                    gridColumn: `${String(segment.startCol + 1)} / ${String(segment.endCol + 2)}`,
                    gridRow: segment.lane + 2,
                  }}
                  className="mt-2xs flex min-h-[10px] items-center overflow-hidden rounded-band bg-band-fill px-1 text-caption font-semibold text-nowrap text-ellipsis text-band-text"
                >
                  {bandDisplayTitle(segment.eventTitle, segment.isCanceled)}
                </span>
              ))}

              {overflowEvents.length > 0 ? (
                <p
                  style={{ gridColumn: "1 / -1", gridRow: MAX_BAND_LANES + 2 }}
                  className="mt-2xs flex min-w-0 items-baseline gap-2xs text-caption text-muted-foreground"
                >
                  <span className="shrink-0 text-nowrap">
                    {`この週にほか${String(overflowEvents.length)}件：`}
                  </span>
                  <span className="min-w-0 flex-1 overflow-hidden text-nowrap text-ellipsis">
                    {overflowEvents.map((hidden, index) => {
                      const title = bandDisplayTitle(
                        hidden.eventTitle,
                        hidden.isCanceled,
                      );
                      return (
                        <span key={hidden.eventId}>
                          {index > 0 ? "、" : null}
                          <Link
                            href={catalogEventHref(
                              hidden.eventId,
                              viewModel.month,
                              selectedDate,
                            )}
                            className="underline hover:text-foreground"
                            title={title}
                          >
                            {title}
                          </Link>
                        </span>
                      );
                    })}
                  </span>
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
