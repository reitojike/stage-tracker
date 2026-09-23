import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/data/database.types";
import type {
  CatalogTicketOpportunityMatch,
  TicketOpportunityMatchRepository,
} from "../ticket-opportunity-candidate-planner";
import { createPrivilegedIngestionClient } from "./supabase";

const RELATED_ROW_LIMIT = 1_000;

function requireBounded<T>(rows: readonly T[]): readonly T[] {
  if (rows.length > RELATED_ROW_LIMIT) {
    throw new Error("Ticket Opportunity match facts exceed the bounded window");
  }
  return rows;
}

export function createTicketOpportunityMatchRepository(
  client: SupabaseClient<Database> = createPrivilegedIngestionClient(),
): TicketOpportunityMatchRepository {
  return {
    async findExactBySourceKey(
      sourceKey,
    ): Promise<CatalogTicketOpportunityMatch | null> {
      const opportunityResult = await client
        .from("ticket_opportunities")
        .select("id, event_id, display_name, target_scope, source_url, memo")
        .eq("source_key", sourceKey)
        .maybeSingle();
      if (opportunityResult.error !== null) {
        throw new Error("Failed to resolve exact Ticket Opportunity identity");
      }
      const opportunity = opportunityResult.data;
      if (opportunity === null) return null;

      const [targetResult, milestoneResult] = await Promise.all([
        client
          .from("ticket_opportunity_target_occurrences")
          .select("occurrence_id")
          .eq("opportunity_id", opportunity.id)
          .limit(RELATED_ROW_LIMIT + 1),
        client
          .from("ticket_opportunity_milestones")
          .select(
            "milestone_type, temporal_precision, date_value, at, starts_at, ends_at",
          )
          .eq("opportunity_id", opportunity.id)
          .order("milestone_type")
          .limit(RELATED_ROW_LIMIT + 1),
      ]);
      if (targetResult.error !== null || milestoneResult.error !== null) {
        throw new Error("Failed to hydrate Ticket Opportunity match facts");
      }
      const targets = requireBounded(targetResult.data);
      const milestones = requireBounded(milestoneResult.data);
      let targetOccurrences: readonly string[] = [];
      if (targets.length > 0) {
        const occurrenceResult = await client
          .from("event_occurrences")
          .select("starts_at")
          .in(
            "id",
            targets.map((target) => target.occurrence_id),
          )
          .order("starts_at")
          .limit(RELATED_ROW_LIMIT + 1);
        if (occurrenceResult.error !== null) {
          throw new Error("Failed to hydrate Ticket Opportunity targets");
        }
        targetOccurrences = requireBounded(occurrenceResult.data).map(
          (occurrence) => occurrence.starts_at,
        );
      }
      return {
        id: opportunity.id,
        eventId: opportunity.event_id,
        displayName: opportunity.display_name,
        targetScope: opportunity.target_scope,
        sourceUrl: opportunity.source_url,
        memo: opportunity.memo,
        targetOccurrences,
        milestones: milestones.map((milestone) => ({
          type: milestone.milestone_type,
          precision: milestone.temporal_precision,
          date: milestone.date_value,
          at: milestone.at,
          startsAt: milestone.starts_at,
          endsAt: milestone.ends_at,
        })),
      };
    },
  };
}
