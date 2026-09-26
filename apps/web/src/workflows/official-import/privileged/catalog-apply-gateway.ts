import "server-only";
import {
  applyEventPlans,
  resolveEventPlans,
  validateEventEntries,
} from "@stage-tracker/official-import/event";
import {
  applyPlans as applyTicketOpportunityPlans,
  resolvePlans as resolveTicketOpportunityPlans,
  StaleTicketOpportunityCatalogError,
  validateSeedEntries,
} from "@stage-tracker/official-import/ticket";
import type {
  EventProposalInput,
  TicketOpportunityProposalInput,
} from "@stage-tracker/official-import/durable-candidate";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/data/database.types";
import {
  OfficialImportCatalogFailure,
  type OfficialImportCatalogApplyPlan,
  type OfficialImportCatalogGateway,
} from "../apply-execution";
import { createPrivilegedIngestionClient } from "./supabase";

function onlyPlan<T>(plans: readonly T[]): T {
  const plan = plans[0];
  if (plan === undefined || plans.length !== 1) {
    throw new OfficialImportCatalogFailure("validation");
  }
  return plan;
}

class SupabaseOfficialImportCatalogGateway implements OfficialImportCatalogGateway {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async prepareEvent(
    proposal: EventProposalInput,
    reviewerId: string,
    targetEventId: string | null,
  ): Promise<OfficialImportCatalogApplyPlan> {
    const validated = validateEventEntries([
      { raw: proposal, where: "approved official import candidate" },
    ]);
    if (!validated.ok) {
      throw new OfficialImportCatalogFailure("validation");
    }
    const resolved = await resolveEventPlans(this.client, validated.entries, {
      owner: { id: reviewerId },
      ...(targetEventId === null
        ? {}
        : {
            targetEventIdsBySourceKey: new Map([
              [proposal.sourceKey, targetEventId],
            ]),
          }),
    });
    if (!resolved.ok) {
      throw new OfficialImportCatalogFailure(
        resolved.retryable ? "unexpected" : "policy_blocked",
      );
    }
    const plan = onlyPlan(resolved.plans);
    if (plan.event !== null && plan.event.canceled_at !== null) {
      throw new OfficialImportCatalogFailure("source_changed");
    }
    const hasChanges =
      plan.action !== "unchanged" ||
      plan.genrePlan.changed ||
      plan.groupsPlan.changed;
    return {
      action: plan.action,
      hasChanges,
      resolvedEventId: plan.event?.id ?? null,
      resolvedTicketOpportunityId: null,
      apply: async () => {
        const result = await applyEventPlans(this.client, [plan], {
          ownerId: reviewerId,
          reviewed: true,
        });
        if (!result.ok) {
          throw new OfficialImportCatalogFailure(
            result.stale ? "source_changed" : "write_conflict",
          );
        }
      },
    };
  }

  async prepareTicketOpportunity(
    proposal: TicketOpportunityProposalInput,
    targetEventId: string | null = null,
  ): Promise<OfficialImportCatalogApplyPlan> {
    const validated = validateSeedEntries([
      { raw: proposal, where: "approved official import candidate" },
    ]);
    if (!validated.ok) {
      throw new OfficialImportCatalogFailure("validation");
    }
    const resolved = await resolveTicketOpportunityPlans(
      this.client,
      validated.entries,
      { targetEventId },
    );
    if (!resolved.ok) {
      throw new OfficialImportCatalogFailure(
        resolved.retryable ? "unexpected" : "target_missing",
      );
    }
    const plan = onlyPlan(resolved.plans);
    if (plan.hasCanceledTarget) {
      throw new OfficialImportCatalogFailure("source_changed");
    }
    return {
      action: plan.action,
      hasChanges: plan.action !== "unchanged",
      resolvedEventId: plan.event.id,
      resolvedTicketOpportunityId: plan.existing?.id ?? null,
      apply: async () => {
        try {
          await applyTicketOpportunityPlans(this.client, [plan], {
            reviewed: true,
          });
        } catch (error) {
          if (error instanceof StaleTicketOpportunityCatalogError) {
            throw new OfficialImportCatalogFailure("source_changed");
          }
          throw new OfficialImportCatalogFailure("write_conflict");
        }
      },
    };
  }
}

export function createOfficialImportCatalogGateway(
  client: SupabaseClient<Database> = createPrivilegedIngestionClient(),
): OfficialImportCatalogGateway {
  return new SupabaseOfficialImportCatalogGateway(client);
}
