import {
  instantToTokyoCalendarDate,
  isCanceled,
  ticketOpportunityMilestoneTokyoCalendarDate,
  type Occurrence,
  type TicketOpportunityTargetScope,
  type TicketOpportunityTimelineRow,
  type TokyoCalendarDate,
} from "@stage-tracker/domain";
import {
  formatTokyoCalendarDateJa,
  formatTokyoTime,
  occurrenceTimeRangeLabel,
} from "./format";

export interface TicketDeadlineBadgeDisplay {
  readonly variant: "deadline" | "outline";
  readonly label: string;
}

function calendarDayDifference(
  from: TokyoCalendarDate,
  to: TokyoCalendarDate,
): number {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(toYear ?? 0, (toMonth ?? 1) - 1, toDay ?? 1) -
      Date.UTC(fromYear ?? 0, (fromMonth ?? 1) - 1, fromDay ?? 1)) /
      86_400_000,
  );
}

/** Shared Home/Tickets urgency cue; it never changes timeline visibility. */
export function ticketDeadlineBadgeDisplay(
  row: Pick<
    TicketOpportunityTimelineRow,
    "milestone" | "myState" | "isPostFinalRetainedHistory"
  > & { readonly isEffectivelyCanceled: boolean },
  today: TokyoCalendarDate,
): TicketDeadlineBadgeDisplay | null {
  if (
    row.myState !== "planned" ||
    row.milestone.milestoneType !== "application_close" ||
    row.isEffectivelyCanceled ||
    row.isPostFinalRetainedHistory
  ) {
    return null;
  }

  const deadlineDate = ticketOpportunityMilestoneTokyoCalendarDate(
    row.milestone,
  );
  const days = calendarDayDifference(today, deadlineDate);
  if (days < 0 || days >= 14) {
    return null;
  }
  if (days === 0) {
    const deadlineTime =
      row.milestone.temporalPrecision === "datetime"
        ? formatTokyoTime(row.milestone.at)
        : row.milestone.temporalPrecision === "window"
          ? formatTokyoTime(row.milestone.endsAt)
          : null;
    return {
      variant: "deadline",
      label: deadlineTime === null ? "本日締切" : `本日 ${deadlineTime}まで`,
    };
  }
  return {
    variant: days <= 3 ? "deadline" : "outline",
    label: `残り${String(days)}日`,
  };
}

export function ticketTargetScopeLabel(
  targetScope: TicketOpportunityTargetScope,
  targetOccurrences: readonly Occurrence[],
): string {
  if (targetScope === "event_wide") {
    return "公演全体";
  }
  if (targetOccurrences.length === 0) {
    return "対象の公演回情報がありません";
  }
  const labels = targetOccurrences.map((occurrence) => {
    const date = formatTokyoCalendarDateJa(
      instantToTokyoCalendarDate(occurrence.startsAt),
    );
    const temporal = occurrenceTimeRangeLabel(
      occurrence.startsAt,
      occurrence.endsAt,
    );
    return `${date} ${temporal}${isCanceled(occurrence) ? "（中止）" : ""}`;
  });
  return `対象公演回: ${labels.join("、")}`;
}
