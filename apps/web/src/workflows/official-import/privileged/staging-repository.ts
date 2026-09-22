import "server-only";
import type {
  EventDurableCandidate,
  TicketOpportunityDurableCandidate,
} from "@stage-tracker/official-import/durable-candidate";
import { parseCanonicalProposal } from "@stage-tracker/official-import/durable-candidate";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/data/database.types";
import type {
  OfficialImportStagingRepository,
  RunFailureClassification,
  RunPreparation,
} from "../shadow-execution";
import { createPrivilegedIngestionClient } from "./supabase";

type CandidateInsert =
  Database["public"]["Tables"]["official_import_candidates"]["Insert"];

function commonInsertFields(
  candidate: EventDurableCandidate | TicketOpportunityDurableCandidate,
): Omit<CandidateInsert, "candidate_kind" | "proposal_version"> {
  return {
    run_id: candidate.runId,
    source_id: candidate.sourceId,
    canonical_url: candidate.canonicalUrl,
    official_external_id: candidate.officialExternalId,
    observed_at: candidate.observedAt,
    content_hash: candidate.contentHash,
    etag: candidate.etag,
    last_modified: candidate.lastModified,
    proposal: candidate.proposal,
    evidence_locator: candidate.evidenceLocator,
    deterministic_match_status: candidate.deterministicMatchStatus,
    semantic_match_status: candidate.semanticMatchStatus,
    resolved_event_id: candidate.resolvedEventId,
    resolved_ticket_opportunity_id: candidate.resolvedTicketOpportunityId,
    jev_decision_evidence: candidate.jevDecisionEvidence,
    plan_summary: candidate.planSummary,
    plan_fingerprint: candidate.planFingerprint,
  };
}

function candidateInsert(
  candidate: EventDurableCandidate | TicketOpportunityDurableCandidate,
): CandidateInsert {
  return {
    ...commonInsertFields(candidate),
    candidate_kind: candidate.candidateKind,
    proposal_version: candidate.proposalVersion,
    proposal: parseCanonicalProposal(
      candidate.candidateKind,
      candidate.proposalVersion,
      candidate.proposal,
    ),
  };
}

function isRunFailureClassification(
  value: string | null,
): value is RunFailureClassification {
  return (
    value === "source_fetch" ||
    value === "source_parse" ||
    value === "provider_unavailable" ||
    value === "validation" ||
    value === "unexpected"
  );
}

function parseFailureClassification(
  value: string | null,
): RunFailureClassification {
  if (!isRunFailureClassification(value))
    throw new Error("Official import run has an invalid failure state");
  return value;
}

class SupabaseOfficialImportStagingRepository implements OfficialImportStagingRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async prepareRun(runId: string, sourceId: string): Promise<RunPreparation> {
    const { error: createError } = await this.client
      .from("official_import_runs")
      .upsert(
        { id: runId, source_id: sourceId },
        { onConflict: "id", ignoreDuplicates: true },
      );
    if (createError !== null)
      throw new Error("Failed to prepare official import run");

    const { data, error: readError } = await this.client
      .from("official_import_runs")
      .select("source_id, status, failure_classification")
      .eq("id", runId)
      .single();
    if (readError !== null || data === null || data.source_id !== sourceId)
      throw new Error("Failed to reuse official import run");

    if (data.status === "completed") {
      const { count, error: countError } = await this.client
        .from("official_import_candidates")
        .select("id", { count: "exact", head: true })
        .eq("run_id", runId);
      if (countError !== null || count === null)
        throw new Error("Failed to read completed official import run");
      return { status: "completed", candidateCount: count };
    }
    if (data.status === "failed") {
      return {
        status: "failed",
        failureClassification: parseFailureClassification(
          data.failure_classification,
        ),
      };
    }
    if (data.status !== "running")
      throw new Error("Official import run has an invalid status");

    // A retry uses the stable Workflow step-derived run ID. Clear any pending
    // batch left by a process loss before staging the batch again.
    const { error: cleanupError } = await this.client
      .from("official_import_candidates")
      .delete()
      .eq("run_id", runId);
    if (cleanupError !== null)
      throw new Error("Failed to reset interrupted official import run");
    return { status: "ready" };
  }

  async insertEventCandidates(
    candidates: readonly EventDurableCandidate[],
  ): Promise<void> {
    const { error } = await this.client
      .from("official_import_candidates")
      .insert(candidates.map(candidateInsert));
    if (error !== null)
      throw new Error("Failed to stage official Event candidate batch");
  }

  async insertTicketOpportunityCandidates(
    candidates: readonly TicketOpportunityDurableCandidate[],
  ): Promise<void> {
    const { error } = await this.client
      .from("official_import_candidates")
      .insert(candidates.map(candidateInsert));
    if (error !== null)
      throw new Error(
        "Failed to stage official TicketOpportunity candidate batch",
      );
  }

  async completeRun(runId: string): Promise<void> {
    const { data, error } = await this.client
      .from("official_import_runs")
      .update({ status: "completed", finished_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("status", "running")
      .select("id")
      .single();
    if (error !== null || data === null)
      throw new Error("Failed to complete official import run");
  }

  async failRun(
    runId: string,
    classification: RunFailureClassification,
  ): Promise<void> {
    const { error: cleanupError } = await this.client
      .from("official_import_candidates")
      .delete()
      .eq("run_id", runId);
    if (cleanupError !== null)
      throw new Error("Failed to clear official import run candidates");

    const { data, error } = await this.client
      .from("official_import_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        failure_classification: classification,
      })
      .eq("id", runId)
      .eq("status", "running")
      .select("id")
      .single();
    if (error !== null || data === null)
      throw new Error("Failed to record official import run failure");
  }
}

export function createOfficialImportStagingRepository(): OfficialImportStagingRepository {
  return new SupabaseOfficialImportStagingRepository(
    createPrivilegedIngestionClient(),
  );
}
