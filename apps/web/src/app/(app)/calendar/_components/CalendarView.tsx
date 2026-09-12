import Link from "next/link";
import {
  isEffectivelyCanceled,
  type TokyoCalendarDate,
  type UserId,
} from "@stage-tracker/domain";
import {
  Badge,
  CompactList,
  LinkButton,
  ListRowLink,
  MonthNavigation,
  StatePanel,
} from "@stage-tracker/ui";
import { cn } from "cn";
import {
  addMonths,
  formatMonthParam,
  tokyoYearMonthOf,
  weekdayLabelJa,
  type TokyoYearMonth,
} from "@/app/_lib/calendar-grid";
import { MAX_BAND_LANES } from "@/app/_lib/calendar-band-layout";
import type { CalendarDayRole } from "@/app/_lib/calendar-day-role";
import {
  formatMonthJa,
  formatTokyoCalendarDateJa,
  occurrenceTimeRangeLabel,
  participationStatusLabel,
  scheduleBlockingLabel,
} from "@/app/_lib/format";
import {
  READ_FAILURE_RETRY_HINT_JA,
  type BlockState,
} from "@/app/_lib/read-state";
import { formatScheduleEntryTemporal } from "../../schedule/_components/formatScheduleEntryTemporal";
import { catalogEventHref } from "../../catalog/_lib/catalog-links";
import type {
  CalendarOccurrenceItem,
  CalendarScheduleItem,
  TokyoDateIndex,
} from "../_lib/calendar-loader";
import {
  buildMyCalendarMonthViewModel,
  selectCalendarMonthOccurrenceGroups,
  selectCalendarMonthScheduleGroups,
  selectCalendarOccurrenceItems,
  selectCalendarScheduleItems,
  type CalendarMonthViewModel,
  type CalendarOccurrenceDateGroup,
  type CalendarScheduleDateGroup,
} from "../_lib/calendar-view-model";

export interface CalendarViewProps {
  readonly month: TokyoYearMonth;
  readonly today: TokyoCalendarDate;
  readonly selectedDate: TokyoCalendarDate | null;
  readonly userId: UserId;
  readonly occurrenceState: BlockState<TokyoDateIndex<CalendarOccurrenceItem>>;
  readonly scheduleState: BlockState<TokyoDateIndex<CalendarScheduleItem>>;
}

const EMPTY_OCCURRENCE_INDEX: TokyoDateIndex<CalendarOccurrenceItem> = {
  items: [],
  byDate: new Map(),
};

const EMPTY_SCHEDULE_INDEX: TokyoDateIndex<CalendarScheduleItem> = {
  items: [],
  byDate: new Map(),
};

function monthHref(month: TokyoYearMonth): string {
  return `/calendar?month=${formatMonthParam(month)}`;
}

function dayHref(date: TokyoCalendarDate): string {
  return `/calendar?month=${formatMonthParam(tokyoYearMonthOf(date))}&date=${date}`;
}

function monthDayLabel(date: TokyoCalendarDate): string {
  const [, month, day] = date.split("-");
  return `${String(Number(month))}月${String(Number(day))}日`;
}

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

function bandDisplayTitle(eventTitle: string, isCanceled: boolean): string {
  return isCanceled ? `${eventTitle}（中止）` : eventTitle;
}

function selectOccurrenceGroupsForScope(
  index: TokyoDateIndex<CalendarOccurrenceItem>,
  month: TokyoYearMonth,
  selectedDate: TokyoCalendarDate | null,
): readonly CalendarOccurrenceDateGroup[] {
  if (selectedDate === null) {
    return selectCalendarMonthOccurrenceGroups(index, month);
  }

  const items = selectCalendarOccurrenceItems(index, selectedDate);
  return items.length === 0 ? [] : [{ date: selectedDate, items }];
}

function selectScheduleGroupsForScope(
  index: TokyoDateIndex<CalendarScheduleItem>,
  month: TokyoYearMonth,
  selectedDate: TokyoCalendarDate | null,
  userId: UserId,
): readonly CalendarScheduleDateGroup[] {
  if (selectedDate === null) {
    return selectCalendarMonthScheduleGroups(index, month, userId);
  }

  const items = selectCalendarScheduleItems(index, userId, selectedDate);
  return items.length === 0 ? [] : [{ date: selectedDate, items }];
}

function isConfirmedEmptyAtScope<T>(
  state: BlockState<T>,
  scopedGroupCount: number,
): boolean {
  return (
    state.variant === "empty" ||
    (state.variant === "populated" && scopedGroupCount === 0)
  );
}

/**
 * `/calendar`'s presentational layer. Read classification stays at the two
 * independent `BlockState`s owned by the loader; this component only projects
 * successful data into the shared month-calendar primitives and renders each
 * source's state separately (P4).
 */
export function CalendarView({
  month,
  today,
  selectedDate,
  userId,
  occurrenceState,
  scheduleState,
}: CalendarViewProps) {
  const occurrenceIndex =
    occurrenceState.variant === "populated"
      ? occurrenceState.data
      : EMPTY_OCCURRENCE_INDEX;
  const scheduleIndex =
    scheduleState.variant === "populated"
      ? scheduleState.data
      : EMPTY_SCHEDULE_INDEX;
  const occurrenceGroups =
    occurrenceState.variant === "populated"
      ? selectOccurrenceGroupsForScope(occurrenceIndex, month, selectedDate)
      : [];
  const scheduleGroups =
    scheduleState.variant === "populated"
      ? selectScheduleGroupsForScope(scheduleIndex, month, selectedDate, userId)
      : [];
  const bothTrulyEmpty =
    isConfirmedEmptyAtScope(occurrenceState, occurrenceGroups.length) &&
    isConfirmedEmptyAtScope(scheduleState, scheduleGroups.length);

  return (
    <div className="flex flex-col gap-section">
      <h1 className="text-heading font-semibold text-foreground">カレンダー</h1>

      <MonthNavigation
        label={formatMonthJa(formatMonthParam(month))}
        previousHref={monthHref(addMonths(month, -1))}
        nextHref={monthHref(addMonths(month, 1))}
      />

      <MonthGrid
        viewModel={buildMyCalendarMonthViewModel(
          month,
          occurrenceIndex,
          scheduleIndex,
          userId,
        )}
        today={today}
        selectedDate={selectedDate}
      />

      {selectedDate !== null ? (
        <h2 className="border-b-2 border-foreground pb-card-block text-title font-semibold text-primary">
          {formatTokyoCalendarDateJa(selectedDate)}
        </h2>
      ) : null}

      {bothTrulyEmpty ? (
        <StatePanel
          variant="empty"
          title={
            selectedDate === null
              ? "この月の予定はありません"
              : "この日の予定はまだありません"
          }
          action={<ScheduleAddLink selectedDate={selectedDate} primary />}
        />
      ) : (
        <>
          <OccurrenceSection
            state={occurrenceState}
            month={month}
            selectedDate={selectedDate}
            groups={occurrenceGroups}
          />
          <ScheduleSection
            state={scheduleState}
            month={month}
            selectedDate={selectedDate}
            groups={scheduleGroups}
          />
          {selectedDate !== null ? (
            <ScheduleAddLink selectedDate={selectedDate} />
          ) : null}
        </>
      )}
    </div>
  );
}

function MonthGrid({
  viewModel,
  today,
  selectedDate,
}: {
  readonly viewModel: CalendarMonthViewModel;
  readonly today: TokyoCalendarDate;
  readonly selectedDate: TokyoCalendarDate | null;
}) {
  const weekdayHeaderDays = viewModel.weeks[0]?.days ?? [];

  return (
    <section
      className="flex flex-col gap-sm"
      aria-label={`${formatMonthJa(formatMonthParam(viewModel.month))}のカレンダー`}
    >
      <div
        className="grid grid-cols-7 gap-2xs text-center text-caption font-semibold text-muted-foreground"
        aria-hidden="true"
      >
        {weekdayHeaderDays.map((day, index) => (
          <span
            key={day.date}
            className={cn(
              "py-2xs",
              index === 6 ? "text-calendar-saturday" : undefined,
              index === 0 ? "text-calendar-sunday" : undefined,
            )}
          >
            {weekdayLabelJa(day.date)}
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

      {/* Each date is a fully-labelled link. We intentionally do not use
          role="grid"/"row"/"gridcell": this bounded tap-target calendar does
          not implement the roving-tabindex keyboard model those roles need. */}
      <div className="flex flex-col gap-2xs">
        {viewModel.weeks.map((week, weekIndex) => (
          <div
            key={weekIndex}
            className="relative grid grid-cols-7 gap-2xs border-t border-border pt-2xs [grid-auto-rows:minmax(0,min-content)]"
          >
            {week.days.map((day, colIndex) => {
              const isToday = day.date === today;
              const isSelected = day.date === selectedDate;
              const bandsThisDay = week.bandLayout.segments.filter(
                (segment) =>
                  segment.startCol <= colIndex && colIndex <= segment.endCol,
              );
              const labelParts = [
                `${formatMonthJa(formatMonthParam(tokyoYearMonthOf(day.date)))}${String(Number(day.date.slice(8, 10)))}日`,
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
              if (day.attendingCount > 0) {
                labelParts.push(
                  `参加する公演回${String(day.attendingCount)}件`,
                );
              }
              if (day.consideringCount > 0) {
                labelParts.push(
                  `気になる公演回${String(day.consideringCount)}件`,
                );
              }
              if (day.ownScheduleCount > 0) {
                labelParts.push(`自分の予定${String(day.ownScheduleCount)}件`);
              }
              if (day.sharedScheduleCount > 0) {
                labelParts.push(
                  `共有されている予定${String(day.sharedScheduleCount)}件`,
                );
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

              return (
                <Link
                  key={day.date}
                  href={dayHref(day.date)}
                  aria-label={labelParts.join("、")}
                  aria-current={isToday ? "date" : undefined}
                  data-date={day.date}
                  style={{ gridColumn: colIndex + 1, gridRow: 1 }}
                  className={cn(
                    "flex min-h-11 min-w-0 flex-col items-center gap-2xs rounded-control-sm border border-transparent p-xs text-body-sm",
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
                        ? cn(
                            "bg-primary text-primary-foreground",
                            day.role === "holiday"
                              ? "font-semibold"
                              : "font-medium",
                          )
                        : roleTextClassName(day.role),
                    )}
                  >
                    {Number(day.date.slice(8, 10))}
                  </span>
                  {day.dot !== "none" ? (
                    <span
                      className="flex h-2 items-center"
                      aria-hidden="true"
                      data-marker-state={day.dot}
                    >
                      <span
                        className={cn(
                          "size-1 rounded-pill",
                          day.dot === "filled"
                            ? "bg-primary"
                            : "border border-primary bg-transparent",
                        )}
                      />
                    </span>
                  ) : null}
                </Link>
              );
            })}

            {week.bandLayout.segments.map((segment) => (
              <span
                key={`${segment.eventId}-${segment.startDate}`}
                aria-hidden="true"
                data-band-kind={segment.kind}
                data-band-event-id={segment.eventId}
                data-band-start-date={segment.startDate}
                data-band-end-date={segment.endDate}
                title={bandDisplayTitle(segment.eventTitle, segment.isCanceled)}
                style={{
                  gridColumn: `${String(segment.startCol + 1)} / ${String(segment.endCol + 2)}`,
                  gridRow: segment.lane + 2,
                }}
                className={cn(
                  "mt-2xs flex min-h-[10px] min-w-0 items-center overflow-hidden rounded-band px-1 text-caption font-semibold text-nowrap text-ellipsis",
                  segment.blocking
                    ? "bg-band-fill text-band-text"
                    : "border border-band-outline bg-transparent text-band-outline",
                )}
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
                  {`この週にほか${String(week.bandLayout.overflowCount)}件：`}
                </span>
                <span className="min-w-0 flex-1 overflow-hidden text-nowrap text-ellipsis">
                  {week.bandLayout.overflowEvents.map((hidden, index) => (
                    <span key={hidden.eventId}>
                      {index > 0 ? "、" : null}
                      <Link
                        href={scheduleEntryHref(
                          hidden.eventId,
                          viewModel.month,
                        )}
                        className="underline hover:text-foreground"
                        title={bandDisplayTitle(
                          hidden.eventTitle,
                          hidden.isCanceled,
                        )}
                      >
                        {bandDisplayTitle(hidden.eventTitle, hidden.isCanceled)}
                      </Link>
                    </span>
                  ))}
                </span>
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <ul className="flex flex-wrap items-center gap-x-sm gap-y-2xs pt-xs text-caption text-muted-foreground">
        <LegendItem dot="filled" label="参加する" />
        <LegendItem dot="outline" label="気になる" />
        <LegendItem band="filled" label="予定を確保する" />
        <LegendItem band="outline" label="予定を確保しない" />
      </ul>
    </section>
  );
}

function scheduleEntryHref(entryId: string, month: TokyoYearMonth): string {
  return `/schedule/${entryId}?month=${formatMonthParam(month)}`;
}

function LegendItem({
  dot,
  band,
  label,
}: {
  readonly dot?: "filled" | "outline";
  readonly band?: "filled" | "outline";
  readonly label: string;
}) {
  return (
    <li className="flex items-center gap-2xs">
      <span
        aria-hidden="true"
        className={cn(
          dot ? "size-1.5 rounded-pill" : "h-2 w-4 rounded-band",
          dot === "filled" || band === "filled"
            ? dot
              ? "bg-primary"
              : "bg-band-fill"
            : "border border-primary bg-transparent",
          band === "outline" ? "border-band-outline" : undefined,
        )}
      />
      {label}
    </li>
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
  groups,
}: {
  readonly state: BlockState<TokyoDateIndex<CalendarOccurrenceItem>>;
  readonly month: TokyoYearMonth;
  readonly selectedDate: TokyoCalendarDate | null;
  readonly groups: readonly CalendarOccurrenceDateGroup[];
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
          month={month}
          selectedDate={selectedDate}
          groups={groups}
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
  month,
  selectedDate,
  groups,
}: {
  readonly month: TokyoYearMonth;
  readonly selectedDate: TokyoCalendarDate | null;
  readonly groups: readonly CalendarOccurrenceDateGroup[];
}) {
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
          <CompactList>
            {group.items.map((item) => (
              <li key={item.occurrence.id}>
                <OccurrenceRow item={item} month={month} date={group.date} />
              </li>
            ))}
          </CompactList>
        </li>
      ))}
    </ul>
  );
}

function OccurrenceRow({
  item,
  month,
  date,
}: {
  readonly item: CalendarOccurrenceItem;
  readonly month: TokyoYearMonth;
  readonly date: TokyoCalendarDate;
}) {
  const canceled = isEffectivelyCanceled(item.event, item.occurrence);

  return (
    <ListRowLink
      href={catalogEventHref(item.event.id, month, date, item.occurrence.id)}
      data-occurrence-id={item.occurrence.id}
    >
      <span className="flex flex-col gap-2xs">
        <span className="text-body-sm text-muted-foreground">
          {occurrenceTimeRangeLabel(
            item.occurrence.startsAt,
            item.occurrence.endsAt,
          )}
        </span>
        <span className="text-title font-medium text-foreground">
          {item.event.title}
        </span>
        {item.event.venue !== null ? (
          <span className="text-body-sm text-muted-foreground">
            {item.event.venue}
          </span>
        ) : null}
        <span className="flex flex-wrap gap-2xs">
          <Badge variant="subtle">
            {participationStatusLabel(item.participation.status)}
          </Badge>
          {canceled ? <Badge variant="terminal">中止</Badge> : null}
        </span>
      </span>
    </ListRowLink>
  );
}

function ScheduleSection({
  state,
  month,
  selectedDate,
  groups,
}: {
  readonly state: BlockState<TokyoDateIndex<CalendarScheduleItem>>;
  readonly month: TokyoYearMonth;
  readonly selectedDate: TokyoCalendarDate | null;
  readonly groups: readonly CalendarScheduleDateGroup[];
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
          month={month}
          selectedDate={selectedDate}
          groups={groups}
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
  month,
  selectedDate,
  groups,
}: {
  readonly month: TokyoYearMonth;
  readonly selectedDate: TokyoCalendarDate | null;
  readonly groups: readonly CalendarScheduleDateGroup[];
}) {
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
          <CompactList>
            {group.items.map((item) => (
              <li key={item.entry.id}>
                <ScheduleRow item={item} month={month} />
              </li>
            ))}
          </CompactList>
        </li>
      ))}
    </ul>
  );
}

function ScheduleRow({
  item,
  month,
}: {
  readonly item: CalendarScheduleDateGroup["items"][number];
  readonly month: TokyoYearMonth;
}) {
  return (
    <ListRowLink
      href={scheduleEntryHref(item.entry.id, month)}
      data-schedule-id={item.entry.id}
    >
      <span className="flex flex-col gap-2xs">
        <span className="flex flex-wrap gap-2xs">
          <Badge variant="subtle">
            {item.isOwner ? "自分の予定" : "共有されている予定"}
          </Badge>
          <Badge variant={item.entry.blocking ? "subtle" : "outline"}>
            {scheduleBlockingLabel(item.entry.blocking)}
          </Badge>
        </span>
        <span className="text-title font-medium text-foreground">
          {item.entry.title}
        </span>
        <span className="text-body-sm text-muted-foreground">
          {formatScheduleEntryTemporal(item.entry.temporal)}
        </span>
        {item.entry.memo !== null && item.entry.memo.length > 0 ? (
          <span className="text-body-sm text-muted-foreground">
            {item.entry.memo}
          </span>
        ) : null}
      </span>
    </ListRowLink>
  );
}

function ScheduleAddLink({
  selectedDate,
  primary = false,
}: {
  readonly selectedDate: TokyoCalendarDate | null;
  readonly primary?: boolean;
}) {
  const label =
    selectedDate === null
      ? "+ 予定を追加"
      : `+ ${monthDayLabel(selectedDate)}に予定を追加`;
  return (
    <LinkButton
      href={`/schedule/new${selectedDate !== null ? `?date=${selectedDate}` : ""}`}
      variant={primary ? "default" : "link"}
      size="sm"
    >
      {label}
    </LinkButton>
  );
}
