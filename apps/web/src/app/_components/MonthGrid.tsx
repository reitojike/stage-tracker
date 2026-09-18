import Link from "next/link";
import type { ReactNode } from "react";
import type { TokyoCalendarDate } from "@stage-tracker/domain";
import { cn } from "cn";
import { weekdayLabelJa } from "@/app/_lib/calendar-grid";
import type { CalendarDayRole } from "@/app/_lib/calendar-day-role";
import { roleTextClassName } from "@/app/_lib/calendar-presentation";

export interface MonthGridDay {
  readonly date: TokyoCalendarDate;
  readonly inCurrentMonth: boolean;
  readonly role: CalendarDayRole;
}

export interface MonthGridWeek<TDay extends MonthGridDay = MonthGridDay> {
  readonly days: readonly TDay[];
}

export interface MonthGridProps<
  TDay extends MonthGridDay,
  TWeek extends MonthGridWeek<TDay>,
> {
  readonly ariaLabel: string;
  readonly weeks: readonly TWeek[];
  readonly hasUnconfirmedHolidayCoverage: boolean;
  readonly renderDay: (
    day: TDay,
    columnIndex: number,
    week: TWeek,
  ) => ReactNode;
  readonly renderWeekOverlays: (week: TWeek, weekIndex: number) => ReactNode;
  readonly footer?: ReactNode;
}

export interface MonthGridDayLinkProps extends MonthGridDay {
  readonly columnIndex: number;
  readonly href: string;
  readonly ariaLabel: string;
  readonly isToday: boolean;
  readonly isSelected: boolean;
  readonly marker?: ReactNode;
}

/**
 * Shared seven-column month-calendar skeleton. Consumers own the meaning of
 * each day marker, band, overflow link, and accessible label through slots.
 * This intentionally remains a bounded tap-target calendar: it does not add
 * ARIA grid roles or roving keyboard navigation.
 */
export function MonthGrid<
  TDay extends MonthGridDay,
  TWeek extends MonthGridWeek<TDay>,
>({
  ariaLabel,
  weeks,
  hasUnconfirmedHolidayCoverage,
  renderDay,
  renderWeekOverlays,
  footer,
}: MonthGridProps<TDay, TWeek>) {
  const weekdayHeaderDates = weeks[0]?.days.map((day) => day.date) ?? [];

  return (
    <section className="flex flex-col gap-sm" aria-label={ariaLabel}>
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

      {hasUnconfirmedHolidayCoverage ? (
        <p
          role="note"
          className="rounded-control border border-dashed border-border p-xs text-caption text-muted-foreground"
        >
          この月の一部の日付は祝日データの公表範囲外です。未公表の祝日は表示されません。
        </p>
      ) : null}

      <div className="flex flex-col gap-2xs">
        {weeks.map((week, weekIndex) => (
          <div
            key={weekIndex}
            className="relative grid grid-cols-7 gap-2xs border-t border-border pt-2xs [grid-auto-rows:minmax(0,min-content)]"
          >
            {week.days.map((day, columnIndex) =>
              renderDay(day, columnIndex, week),
            )}
            {renderWeekOverlays(week, weekIndex)}
          </div>
        ))}
      </div>

      {footer}
    </section>
  );
}

/** Shared day-cell shell; marker content remains consumer-owned. */
export function MonthGridDayLink({
  date,
  columnIndex,
  inCurrentMonth,
  role,
  href,
  ariaLabel,
  isToday,
  isSelected,
  marker,
}: MonthGridDayLinkProps) {
  const dayNumber = Number(date.slice(8, 10));

  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      aria-current={isToday ? "date" : undefined}
      data-date={date}
      style={{ gridColumn: columnIndex + 1, gridRow: 1 }}
      className={cn(
        "flex min-h-11 min-w-0 flex-col items-center gap-2xs rounded-control-sm border border-transparent p-xs text-body-sm",
        inCurrentMonth ? "text-foreground" : "text-muted-foreground",
        isSelected ? "border-primary bg-muted" : "hover:bg-muted",
      )}
    >
      <span
        className={cn(
          "flex size-6 items-center justify-center rounded-pill",
          isToday
            ? cn(
                "bg-primary text-primary-foreground",
                // Keep the holiday's non-color weight cue when today uses the
                // filled primary treatment. The accessible label also keeps
                // the holiday meaning explicit; selected is separate.
                role === "holiday" ? "font-semibold" : "font-medium",
              )
            : roleTextClassName(role),
        )}
      >
        {dayNumber}
      </span>
      {marker}
    </Link>
  );
}
