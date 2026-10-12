import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isTicketOpportunityMilestonePast,
  ticketOpportunityIdSchema,
  ticketOpportunityMilestoneSortInstant,
  type TicketOpportunityId,
  type UserId,
  type UserTicketOpportunityStatus,
} from "@stage-tracker/domain";
import {
  listMyTicketOpportunityStates,
  listTicketOpportunities,
  type TicketOpportunityDetail,
} from "@/lib/data";
import type { Database } from "@/lib/data/database.types";
import { classifyBlock2Optional } from "@/app/_lib/read-state";
import type { ScreenNow } from "@/app/_lib/now";

export type TicketSelection =
  | { readonly kind: "list" }
  | { readonly kind: "invalid" }
  | { readonly kind: "selected"; readonly id: TicketOpportunityId };

/** Presence takes precedence over view; repeated values are never guessed. */
export function parseTicketSelection(
  value: string | string[] | undefined,
): TicketSelection {
  if (value === undefined) return { kind: "list" };
  if (typeof value !== "string") return { kind: "invalid" };
  const result = ticketOpportunityIdSchema.safeParse(value.toLowerCase());
  return result.success
    ? { kind: "selected", id: result.data }
    : { kind: "invalid" };
}

export interface SelectedTicket {
  readonly detail: TicketOpportunityDetail;
  readonly myState: UserTicketOpportunityStatus | null;
  readonly pastMilestoneIds: readonly string[];
  readonly canChangeState: boolean;
}

/** Read the public snapshot before the timeline's bounded date projection. */
export async function loadSelectedTicket(
  supabase: SupabaseClient<Database>,
  userId: UserId,
  opportunityId: TicketOpportunityId,
  now: ScreenNow,
) {
  const [publicResult, ownResult] = await Promise.all([
    listTicketOpportunities(supabase),
    listMyTicketOpportunityStates(supabase, userId),
  ]);
  return classifyBlock2Optional(
    publicResult,
    ownResult,
    [],
    (details, ownStates): SelectedTicket | null => {
      const detail = details.find(
        (entry) =>
          entry.opportunityWithTargets.opportunity.id === opportunityId,
      );
      if (detail === undefined) return null;
      const pastMilestoneIds = detail.milestones
        .filter((milestone) =>
          isTicketOpportunityMilestonePast(
            milestone,
            now.nowInstant,
            now.todayTokyoDate,
          ),
        )
        .map((milestone) => milestone.id);
      return {
        detail: {
          ...detail,
          milestones: [...detail.milestones].sort((a, b) =>
            ticketOpportunityMilestoneSortInstant(a).localeCompare(
              ticketOpportunityMilestoneSortInstant(b),
            ),
          ),
        },
        myState:
          ownStates.find((entry) => entry.opportunityId === opportunityId)
            ?.status ?? null,
        pastMilestoneIds,
        canChangeState:
          !detail.isEffectivelyCanceled &&
          pastMilestoneIds.length < detail.milestones.length,
      };
    },
    (selected) => selected === null,
  );
}
