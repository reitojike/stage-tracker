import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildTicketOpportunityTimelineRows,
  groupTicketOpportunityTimelineRowsByMonth,
  selectTicketOpportunityPrimaryRows,
  type TicketOpportunityTimelineMonthGroup,
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
 * Known gap (documented in this Task's report, not fabricated around): the
 * oracle's badge priority for this screen names 5 tiers, the highest being
 * "①中止". Computing that requires the parent Event's and (for
 * `selected_occurrences` Opportunities) the target Occurrences' cancellation
 * state, which `@stage-tracker/lib/data`'s ticket reads
 * (`listTicketOpportunities`) do not join in - only `ticket_opportunities`,
 * `ticket_opportunity_milestones`, and the *bare occurrence ids* of
 * `ticket_opportunity_target_occurrences` (no `canceled_at`). This loader
 * therefore cannot classify "中止" and the badge priority implemented here
 * starts at tier ② (see `../_components/TicketsView.tsx`).
 */
export interface TicketsTimelineState {
  readonly groups: readonly TicketOpportunityTimelineMonthGroup[];
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
      return { groups: groupTicketOpportunityTimelineRowsByMonth(primaryRows) };
    },
    (data) => data.groups.length === 0,
  );
}
