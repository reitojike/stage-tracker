import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildTicketOpportunityTimelineRows,
  groupTicketOpportunityTimelineRowsByMonth,
  selectTicketOpportunityPrimaryRows,
  type TicketOpportunityTimelineRow,
  type Occurrence,
  type TicketOpportunityTargetScope,
  type UserId,
} from "@stage-tracker/domain";
import {
  buildTicketOpportunityAggregates,
  listMyTicketOpportunityStates,
  listTicketOpportunities,
} from "@/lib/data";
import {
  classifyBlock2Optional,
  type OptionalPartBlockState,
} from "@/app/_lib/read-state";
import type { ScreenNow } from "@/app/_lib/now";

/**
 * `/tickets`'s data layer (`docs/v2/oracle-routes-ui.md` §1 `/tickets`).
 *
 * Unlike home's "申し込み期限" block (`../../_lib/home-loader.ts`), this
 * screen is the full timeline: every Opportunity's current/next milestone
 * *and* its bounded post-final retained history
 * (`@stage-tracker/domain`'s `selectTicketOpportunityPrimaryRows` -
 * `isPostFinalRetainedHistory` rows are kept here, not filtered out), grouped
 * into month buckets for display (oracle §2 「チケット一覧」's month-grouped
 * timeline).
 *
 * Same read-granularity P4 shape as home's "申し込み期限" block (PR #381
 * review finding 1): `listTicketOpportunities` is required,
 * `listMyTicketOpportunityStates` is optional and degrades `block`'s data to
 * "no personal state" (`[]`) rather than hiding the shared timeline -
 * `classifyBlock2Optional`'s own docstring in `@/app/_lib/read-state.ts`
 * has the full reasoning. The returned `optional` field (PR #381 P4
 * follow-up review finding 2) always carries the personal-state read's own
 * status, so `../_components/TicketsView.tsx` can render its `myState`
 * badge as "不明" - not silently omitted - when `optional.ok` is `false`,
 * instead of that failure being indistinguishable from every row genuinely
 * having no personal state.
 *
 * Cancellation is classified at the shared read boundary using the canonical
 * `isTicketOpportunityEffectivelyCanceled` domain function. The resulting
 * source-backed classification is carried onto each timeline row for the
 * View; the timeline ordering/retention algorithm itself remains cancellation-
 * agnostic.
 */
export type TicketsTimelineRow = TicketOpportunityTimelineRow & {
  readonly isEffectivelyCanceled: boolean;
  readonly eventTitle: string;
  readonly eventVenue: string | null;
  readonly targetScope: TicketOpportunityTargetScope;
  readonly targetOccurrences: readonly Occurrence[];
  readonly sourceUrl: string | null;
};

export interface TicketsTimelineMonthGroup {
  readonly monthKey: string;
  readonly rows: readonly TicketsTimelineRow[];
}

export interface TicketsTimelineState {
  readonly groups: readonly TicketsTimelineMonthGroup[];
}

export async function loadTicketsTimeline(
  supabase: SupabaseClient,
  userId: UserId,
  now: ScreenNow,
): Promise<OptionalPartBlockState<TicketsTimelineState>> {
  const [opportunitiesResult, statesResult] = await Promise.all([
    listTicketOpportunities(supabase),
    listMyTicketOpportunityStates(supabase, userId),
  ]);

  return classifyBlock2Optional(
    opportunitiesResult,
    statesResult,
    [],
    (opportunities, states) => {
      const aggregates = buildTicketOpportunityAggregates(
        opportunities,
        states,
      );
      const timelineRows = buildTicketOpportunityTimelineRows(aggregates);
      const primaryRows = selectTicketOpportunityPrimaryRows(
        timelineRows,
        now.nowInstant,
        now.todayTokyoDate,
      );
      const canceledOpportunityIds = new Set(
        opportunities
          .filter((detail) => detail.isEffectivelyCanceled)
          .map((detail) => detail.opportunityWithTargets.opportunity.id),
      );
      const detailByOpportunityId = new Map(
        opportunities.map(
          (detail) =>
            [detail.opportunityWithTargets.opportunity.id, detail] as const,
        ),
      );
      const groups = groupTicketOpportunityTimelineRowsByMonth(primaryRows);
      return {
        groups: groups.map((group) => ({
          ...group,
          rows: group.rows.map((row) => {
            const detail = detailByOpportunityId.get(row.opportunityId);
            if (detail === undefined) {
              throw new Error(
                `unreachable: timeline row has no source opportunity detail (${row.opportunityId})`,
              );
            }
            return {
              ...row,
              isEffectivelyCanceled: canceledOpportunityIds.has(
                row.opportunityId,
              ),
              eventTitle: detail.eventTitle,
              eventVenue: detail.eventVenue,
              targetScope:
                detail.opportunityWithTargets.opportunity.targetScope,
              targetOccurrences: detail.targetOccurrences,
              sourceUrl: detail.opportunityWithTargets.opportunity.sourceUrl,
            };
          }),
        })),
      };
    },
    (data) => data.groups.length === 0,
  );
}
