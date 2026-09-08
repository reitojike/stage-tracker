import {
  instantToTokyoCalendarDate,
  type TicketOpportunityMilestone,
  type TicketOpportunityMilestoneType,
} from "@stage-tracker/domain";
import { formatTokyoCalendarDateJa, formatTokyoTime } from "./format";

/**
 * Display labels for `TicketOpportunityMilestoneType`
 * (`@stage-tracker/domain`'s `ticketOpportunityMilestoneTypeSchema`). Shared
 * by `/` (home's "申し込み期限" block) and `/tickets` (the full timeline) -
 * both render the same milestone rows, just filtered/grouped differently.
 * The oracle names the 5 milestone kinds
 * (`docs/v2/oracle-routes-ui.md`/AGENTS.md "Milestone") but does not specify
 * their exact Japanese label text; these are this Task's own reasonable
 * choice (see this Task's report).
 */
const MILESTONE_TYPE_LABELS_JA: Record<TicketOpportunityMilestoneType, string> =
  {
    application_open: "受付開始",
    application_close: "受付締切",
    result_announcement: "当落発表",
    sale_start: "販売開始",
    payment_window: "支払期間",
  };

export function formatMilestoneTypeJa(
  type: TicketOpportunityMilestoneType,
): string {
  return MILESTONE_TYPE_LABELS_JA[type];
}

/** Renders a milestone's "when" respecting its own `temporalPrecision` -
 * never fabricates a time for a `date`-precision milestone (AGENTS.md
 * "source が与えていない時刻を補完しません"). */
export function formatMilestoneWhenJa(
  milestone: TicketOpportunityMilestone,
): string {
  switch (milestone.temporalPrecision) {
    case "date":
      return formatTokyoCalendarDateJa(milestone.dateValue);
    case "datetime":
      return `${formatTokyoCalendarDateJa(instantToTokyoCalendarDate(milestone.at))} ${formatTokyoTime(milestone.at)}`;
    case "window": {
      const startDate = instantToTokyoCalendarDate(milestone.startsAt);
      const endDate = instantToTokyoCalendarDate(milestone.endsAt);
      const startLabel = `${formatTokyoCalendarDateJa(startDate)} ${formatTokyoTime(milestone.startsAt)}`;
      const endLabel =
        startDate === endDate
          ? formatTokyoTime(milestone.endsAt)
          : `${formatTokyoCalendarDateJa(endDate)} ${formatTokyoTime(milestone.endsAt)}`;
      return `${startLabel}〜${endLabel}`;
    }
  }
}
