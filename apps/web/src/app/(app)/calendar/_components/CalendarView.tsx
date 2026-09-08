import Link from "next/link";
import {
  isEffectivelyCanceled,
  type TokyoCalendarDate,
} from "@stage-tracker/domain";
import { Badge, StatePanel } from "@stage-tracker/ui";
import { cn } from "cn";
import {
  addMonths,
  buildMonthGridDays,
  formatMonthParam,
  tokyoYearMonthOf,
  weekdayLabelJa,
  type TokyoYearMonth,
} from "@/app/_lib/calendar-grid";
import {
  formatMonthJa,
  formatTokyoCalendarDateJa,
  formatTokyoTime,
} from "@/app/_lib/format";
import {
  READ_FAILURE_RETRY_HINT_JA,
  type BlockState,
} from "@/app/_lib/read-state";
import {
  compareCalendarOccurrenceItems,
  type CalendarOccurrenceItem,
  type CalendarScheduleItem,
  type TokyoDateIndex,
} from "../_lib/calendar-loader";

export interface CalendarViewProps {
  readonly month: TokyoYearMonth;
  readonly today: TokyoCalendarDate;
  readonly selectedDate: TokyoCalendarDate | null;
  readonly occurrenceState: BlockState<TokyoDateIndex<CalendarOccurrenceItem>>;
  readonly scheduleState: BlockState<TokyoDateIndex<CalendarScheduleItem>>;
}

function monthHref(month: TokyoYearMonth): string {
  return `/calendar?month=${formatMonthParam(month)}`;
}

function dayHref(month: TokyoYearMonth, date: TokyoCalendarDate): string {
  const dateMonth = tokyoYearMonthOf(date);
  return `/calendar?month=${formatMonthParam(dateMonth)}&date=${date}`;
}

/**
 * `/calendar`'s presentational layer (`docs/v2/oracle-routes-ui.md` §2
 * 「カレンダー」). Renders the 2 already-classified blocks
 * (`../_lib/calendar-loader.ts`) independently (`docs/v2/decisions.md` P4) -
 * see that file's own header for why this screen has 2 blocks rather than 1
 * combined read, which is the part of this screen that deliberately departs
 * from the legacy single-error-panel behavior.
 *
 * Simplification versus the oracle's legacy description (documented in this
 * Task's report): the legacy calendar renders one fused agenda/day list
 * across both occurrence and personal-schedule items. Because P4 requires
 * the 2 reads to degrade independently, this component instead renders 2
 * clearly-labeled subsections ("参加予定"/"個人の予定") that can each show
 * their own `StatePanel` state - fusing them back into one list would
 * require re-combining the 2 reads into a single failure/success outcome,
 * which is exactly what P4 moves away from.
 */
export function CalendarView({
  month,
  today,
  selectedDate,
  occurrenceState,
  scheduleState,
}: CalendarViewProps) {
  const gridDays = buildMonthGridDays(month);
  const bothTrulyEmpty =
    occurrenceState.variant === "empty" && scheduleState.variant === "empty";

  return (
    <div className="flex flex-col gap-section">
      <h1 className="text-heading font-semibold text-foreground">カレンダー</h1>

      <MonthNav month={month} />

      <MonthGrid
        month={month}
        today={today}
        selectedDate={selectedDate}
        gridDays={gridDays}
        occurrenceState={occurrenceState}
        scheduleState={scheduleState}
      />

      {bothTrulyEmpty ? (
        <StatePanel
          variant="empty"
          title={
            selectedDate === null
              ? "この月の予定はありません"
              : "この日の予定はまだありません"
          }
          action={
            <Link
              href={`/schedule/new${selectedDate !== null ? `?date=${selectedDate}` : ""}`}
              className="text-body-sm font-medium text-primary"
            >
              + 予定を追加
            </Link>
          }
        />
      ) : (
        <>
          <OccurrenceSection
            state={occurrenceState}
            month={month}
            selectedDate={selectedDate}
          />
          <ScheduleSection
            state={scheduleState}
            month={month}
            selectedDate={selectedDate}
          />
          {selectedDate !== null ? (
            <Link
              href={`/schedule/new?date=${selectedDate}`}
              className="text-body-sm font-medium text-primary"
            >
              + 予定を追加
            </Link>
          ) : null}
        </>
      )}
    </div>
  );
}

function MonthNav({ month }: { readonly month: TokyoYearMonth }) {
  return (
    <div className="flex items-center justify-between">
      <Link
        href={monthHref(addMonths(month, -1))}
        className="text-body-sm text-primary"
      >
        ‹ 前の月
      </Link>
      <span className="text-title font-semibold text-foreground">
        {formatMonthJa(formatMonthParam(month))}
      </span>
      <Link
        href={monthHref(addMonths(month, 1))}
        className="text-body-sm text-primary"
      >
        次の月 ›
      </Link>
    </div>
  );
}

function MonthGrid({
  month,
  today,
  selectedDate,
  gridDays,
  occurrenceState,
  scheduleState,
}: {
  readonly month: TokyoYearMonth;
  readonly today: TokyoCalendarDate;
  readonly selectedDate: TokyoCalendarDate | null;
  readonly gridDays: readonly TokyoCalendarDate[];
  readonly occurrenceState: BlockState<TokyoDateIndex<CalendarOccurrenceItem>>;
  readonly scheduleState: BlockState<TokyoDateIndex<CalendarScheduleItem>>;
}) {
  const weekdayHeader = gridDays.slice(0, 7);

  return (
    <div
      className="flex flex-col gap-2xs"
      role="grid"
      aria-label="月間カレンダー"
    >
      <div className="grid grid-cols-7 gap-2xs text-center text-caption text-muted-foreground">
        {weekdayHeader.map((date) => (
          <span key={date}>{weekdayLabelJa(date)}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2xs">
        {gridDays.map((date) => {
          const inCurrentMonth = tokyoYearMonthOf(date).month === month.month;
          const hasOccurrence =
            occurrenceState.variant === "populated" &&
            occurrenceState.data.byDate.has(date);
          const hasSchedule =
            scheduleState.variant === "populated" &&
            scheduleState.data.byDate.has(date);
          const isToday = date === today;
          const isSelected = date === selectedDate;

          return (
            <Link
              key={date}
              href={dayHref(month, date)}
              aria-current={isSelected ? "date" : undefined}
              className={cn(
                "flex flex-col items-center gap-2xs rounded-control-sm border border-transparent p-xs text-body-sm",
                inCurrentMonth ? "text-foreground" : "text-muted-foreground",
                isSelected ? "border-primary bg-muted" : "hover:bg-muted",
              )}
            >
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-pill",
                  isToday ? "bg-primary text-primary-foreground" : undefined,
                )}
              >
                {Number(date.slice(8, 10))}
              </span>
              <span className="flex gap-2xs" aria-hidden>
                {hasOccurrence ? (
                  <span className="size-1 rounded-pill bg-primary" />
                ) : null}
                {hasSchedule ? (
                  <span className="size-1 rounded-pill bg-band-text" />
                ) : null}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function blockPanelCopy(
  variant: "empty" | "error" | "unavailable",
  emptyTitle: string,
  unavailableTitle: string,
  errorTitle: string,
): string {
  if (variant === "empty") return emptyTitle;
  if (variant === "unavailable") return unavailableTitle;
  return errorTitle;
}

function OccurrenceSection({
  state,
  month,
  selectedDate,
}: {
  readonly state: BlockState<TokyoDateIndex<CalendarOccurrenceItem>>;
  readonly month: TokyoYearMonth;
  readonly selectedDate: TokyoCalendarDate | null;
}) {
  return (
    <section
      aria-labelledby="calendar-occurrences-heading"
      className="flex flex-col gap-sm"
    >
      <h2
        id="calendar-occurrences-heading"
        className="text-title font-semibold text-foreground"
      >
        参加予定
      </h2>
      {state.variant === "populated" ? (
        <OccurrenceList
          index={state.data}
          month={month}
          selectedDate={selectedDate}
        />
      ) : (
        <StatePanel
          variant={state.variant}
          title={blockPanelCopy(
            state.variant,
            "参加予定はありません",
            "参加予定を確認できません",
            "参加予定を読み込めませんでした",
          )}
          {...(state.variant === "error"
            ? { description: READ_FAILURE_RETRY_HINT_JA }
            : {})}
        />
      )}
    </section>
  );
}

function OccurrenceList({
  index,
  month,
  selectedDate,
}: {
  readonly index: TokyoDateIndex<CalendarOccurrenceItem>;
  readonly month: TokyoYearMonth;
  readonly selectedDate: TokyoCalendarDate | null;
}) {
  const dates =
    selectedDate !== null
      ? [selectedDate]
      : [...index.byDate.keys()]
          .filter((date) => tokyoYearMonthOf(date).month === month.month)
          .sort();

  const groups = dates
    .map((date) => ({
      date,
      items: [...(index.byDate.get(date) ?? [])].sort(
        compareCalendarOccurrenceItems,
      ),
    }))
    .filter((group) => group.items.length > 0);

  if (groups.length === 0) {
    return (
      <p className="text-body-sm text-muted-foreground">
        {selectedDate !== null
          ? "この日の参加予定はありません"
          : "この月の参加予定はありません"}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-sm">
      {groups.map((group) => (
        <li key={group.date} className="flex flex-col gap-2xs">
          {selectedDate === null ? (
            <span className="text-body-sm font-medium text-muted-foreground">
              {formatTokyoCalendarDateJa(group.date)}
            </span>
          ) : null}
          <ul className="flex flex-col gap-2xs">
            {group.items.map((item) => (
              <li key={item.participation.id}>
                <Link
                  href={`/catalog/events/${item.event.id}?occurrence=${item.occurrence.id}`}
                  className="flex items-center justify-between gap-sm rounded-control border border-border bg-card p-md hover:bg-muted"
                >
                  <span className="flex flex-col gap-2xs">
                    <span className="text-body-sm text-muted-foreground">
                      {formatTokyoTime(item.occurrence.startsAt)}
                    </span>
                    <span className="text-title font-medium text-foreground">
                      {item.event.title}
                    </span>
                  </span>
                  {isEffectivelyCanceled(item.event, item.occurrence) ? (
                    <Badge variant="terminal">中止</Badge>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function ScheduleSection({
  state,
  month,
  selectedDate,
}: {
  readonly state: BlockState<TokyoDateIndex<CalendarScheduleItem>>;
  readonly month: TokyoYearMonth;
  readonly selectedDate: TokyoCalendarDate | null;
}) {
  return (
    <section
      aria-labelledby="calendar-schedule-heading"
      className="flex flex-col gap-sm"
    >
      <h2
        id="calendar-schedule-heading"
        className="text-title font-semibold text-foreground"
      >
        個人の予定
      </h2>
      {state.variant === "populated" ? (
        <ScheduleList
          index={state.data}
          month={month}
          selectedDate={selectedDate}
        />
      ) : (
        <StatePanel
          variant={state.variant}
          title={blockPanelCopy(
            state.variant,
            "個人の予定はありません",
            "個人の予定を確認できません",
            "個人の予定を読み込めませんでした",
          )}
          {...(state.variant === "error"
            ? { description: READ_FAILURE_RETRY_HINT_JA }
            : {})}
        />
      )}
    </section>
  );
}

function ScheduleList({
  index,
  month,
  selectedDate,
}: {
  readonly index: TokyoDateIndex<CalendarScheduleItem>;
  readonly month: TokyoYearMonth;
  readonly selectedDate: TokyoCalendarDate | null;
}) {
  const dates =
    selectedDate !== null
      ? [selectedDate]
      : [...index.byDate.keys()]
          .filter((date) => tokyoYearMonthOf(date).month === month.month)
          .sort();

  const groups = dates
    .map((date) => ({ date, items: index.byDate.get(date) ?? [] }))
    .filter((group) => group.items.length > 0);

  if (groups.length === 0) {
    return (
      <p className="text-body-sm text-muted-foreground">
        {selectedDate !== null
          ? "この日の個人の予定はありません"
          : "この月の個人の予定はありません"}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-sm">
      {groups.map((group) => (
        <li key={group.date} className="flex flex-col gap-2xs">
          {selectedDate === null ? (
            <span className="text-body-sm font-medium text-muted-foreground">
              {formatTokyoCalendarDateJa(group.date)}
            </span>
          ) : null}
          <ul className="flex flex-col gap-2xs">
            {group.items.map((item) => (
              <li key={item.entry.id}>
                <Link
                  href={`/schedule/${item.entry.id}`}
                  className="flex items-center justify-between gap-sm rounded-control border border-border bg-card p-md hover:bg-muted"
                >
                  <span className="flex flex-col gap-2xs">
                    {item.entry.temporal.kind === "time-bounded" ? (
                      <span className="text-body-sm text-muted-foreground">
                        {formatTokyoTime(item.entry.temporal.startsAt)}
                      </span>
                    ) : null}
                    <span className="text-title font-medium text-foreground">
                      {item.entry.title}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
