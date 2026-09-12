"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  buildMonthGridDays,
  isRenderableMonth,
  parseDateParam,
  parseMonthParam,
  tokyoYearMonthOf,
  weekdayLabelJa,
  type TokyoYearMonth,
} from "@/app/_lib/calendar-grid";

const WEEKDAYS = 7;

export interface CalendarSkeletonProps {
  readonly sectionLabel: string;
  readonly fallbackLabel: string;
}

function resolveSkeletonMonth(
  searchParams: Readonly<URLSearchParams>,
): TokyoYearMonth | null {
  const selectedDate = parseDateParam(searchParams.get("date") ?? undefined);
  if (selectedDate !== null) {
    const monthFromDate = tokyoYearMonthOf(selectedDate);
    if (isRenderableMonth(monthFromDate)) {
      return monthFromDate;
    }
  }

  const monthFromParam = parseMonthParam(
    searchParams.get("month") ?? undefined,
    { year: -1, month: 0 },
  );
  return monthFromParam.year >= 0 && isRenderableMonth(monthFromParam)
    ? monthFromParam
    : null;
}

function monthLabel(month: TokyoYearMonth): string {
  return String(month.year) + "年" + String(month.month) + "月";
}

function CalendarSkeletonContent({
  sectionLabel,
  fallbackLabel,
}: CalendarSkeletonProps) {
  const searchParams = useSearchParams();
  const month = resolveSkeletonMonth(searchParams);

  if (month === null) {
    return (
      <p role="status" className="text-body-sm text-muted-foreground">
        {fallbackLabel}
      </p>
    );
  }

  const days = buildMonthGridDays(month);
  const weeks = Array.from(
    { length: Math.ceil(days.length / WEEKDAYS) },
    (_, weekIndex) =>
      days.slice(weekIndex * WEEKDAYS, (weekIndex + 1) * WEEKDAYS),
  );

  return (
    <section
      role="status"
      aria-label={monthLabel(month) + "の" + sectionLabel + "を読み込み中"}
      className="flex flex-col gap-sm"
    >
      <div
        className="flex min-h-11 items-center justify-between"
        aria-hidden="true"
      >
        <span className="size-11 rounded-control-sm bg-muted/70" />
        <span className="text-title font-semibold text-muted-foreground">
          {monthLabel(month)}
        </span>
        <span className="size-11 rounded-control-sm bg-muted/70" />
      </div>

      <div
        className="grid grid-cols-7 gap-2xs text-center text-caption font-semibold text-muted-foreground"
        aria-hidden="true"
      >
        {days.slice(0, WEEKDAYS).map((date) => (
          <span key={date} className="py-2xs opacity-50">
            {weekdayLabelJa(date)}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-2xs" aria-hidden="true">
        {weeks.map((week, weekIndex) => (
          <div
            key={weekIndex}
            className="grid grid-cols-7 gap-2xs border-t border-border pt-2xs [grid-auto-rows:minmax(0,min-content)]"
          >
            {week.map((date) => (
              <span
                key={date}
                className="block min-h-11 rounded-control-sm bg-muted/70"
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Route fallback for both calendar-shaped screens. URL-derived context is
 * explicit-only: without a valid month/date, the server page's Tokyo "today"
 * default is unknowable here, so this does not guess with a browser clock.
 * A valid date wins over a disagreeing month, matching the destination pages.
 */
export function CalendarSkeleton(props: CalendarSkeletonProps) {
  return (
    <Suspense fallback={<p role="status">{props.fallbackLabel}</p>}>
      <CalendarSkeletonContent {...props} />
    </Suspense>
  );
}
