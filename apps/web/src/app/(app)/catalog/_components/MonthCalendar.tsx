import Link from "next/link";
import type { TokyoCalendarDate } from "@stage-tracker/domain";
import { MonthGrid, MonthGridDayLink } from "@/app/_components/MonthGrid";
import { tokyoYearMonthOf } from "@/app/_lib/calendar-grid";
import { MAX_BAND_LANES } from "@/app/_lib/calendar-band-layout";
import { bandDisplayTitle } from "@/app/_lib/calendar-presentation";
import { formatMonthJa } from "@/app/_lib/format";
import type {
  DayCellViewModel,
  MonthCalendarViewModel,
  WeekViewModel,
} from "../_lib/calendar-view-model";
import { catalogDayHref, catalogEventHref } from "../_lib/catalog-links";

export interface MonthCalendarProps {
  readonly viewModel: MonthCalendarViewModel;
  readonly selectedDate: TokyoCalendarDate | null;
  readonly today: TokyoCalendarDate;
}

/**
 * `/catalog` owns Event publication markers and selected-day navigation. The
 * month grid header, day-cell shell, holiday notice, and week layout are
 * shared through `MonthGrid`; consumer-specific labels and Event bands stay
 * here so Catalog remains an Event-information surface.
 */
export function MonthCalendar({
  viewModel,
  selectedDate,
  today,
}: MonthCalendarProps) {
  return (
    <MonthGrid<DayCellViewModel, WeekViewModel>
      ariaLabel={`${formatMonthJa(viewModel.month)}のイベントカレンダー`}
      weeks={viewModel.weeks}
      hasUnconfirmedHolidayCoverage={viewModel.hasUnconfirmedHolidayCoverage}
      renderDay={(day, columnIndex, week) => {
        const dayNumber = Number(day.date.slice(8, 10));
        const bandsThisDay = week.bandLayout.segments.filter(
          (segment) =>
            segment.startCol <= columnIndex && columnIndex <= segment.endCol,
        );
        const isToday = day.date === today;
        const isSelected = day.date === selectedDate;
        const labelParts = [
          `${formatMonthJa(tokyoYearMonthOf(day.date))}${String(dayNumber)}日`,
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
                bandDisplayTitle(segment.eventTitle, segment.isCanceled),
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
          <MonthGridDayLink
            key={day.date}
            date={day.date}
            inCurrentMonth={day.inCurrentMonth}
            role={day.role}
            columnIndex={columnIndex}
            href={catalogDayHref(day.date)}
            ariaLabel={labelParts.join("、")}
            isToday={isToday}
            isSelected={isSelected}
            marker={
              day.badgeCount > 0 ? (
                <span aria-hidden="true" className="flex h-2 items-center">
                  <span className="size-1 rounded-pill bg-primary" />
                </span>
              ) : null
            }
          />
        );
      }}
      renderWeekOverlays={(week) => (
        <>
          {week.bandLayout.segments.map((segment) => (
            <span
              key={`${segment.eventId}-${segment.startDate}`}
              aria-hidden="true"
              data-band-event-id={segment.eventId}
              title={bandDisplayTitle(segment.eventTitle, segment.isCanceled)}
              style={{
                gridColumn: `${String(segment.startCol + 1)} / ${String(segment.endCol + 2)}`,
                gridRow: segment.lane + 2,
              }}
              className="mt-2xs flex min-h-[10px] items-center overflow-hidden rounded-band bg-band-fill px-1 text-caption font-semibold text-nowrap text-ellipsis text-band-text"
            >
              {bandDisplayTitle(segment.eventTitle, segment.isCanceled)}
            </span>
          ))}

          {week.bandLayout.overflowEvents.length > 0 ? (
            <p
              style={{
                gridColumn: "1 / -1",
                gridRow: MAX_BAND_LANES + 2,
              }}
              className="mt-2xs flex min-w-0 items-baseline gap-2xs text-caption text-muted-foreground"
            >
              <span className="shrink-0 text-nowrap">
                {`この週にほか${String(week.bandLayout.overflowEvents.length)}件：`}
              </span>
              <span className="min-w-0 flex-1 overflow-hidden text-nowrap text-ellipsis">
                {week.bandLayout.overflowEvents.map((hidden, index) => {
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
        </>
      )}
    />
  );
}
