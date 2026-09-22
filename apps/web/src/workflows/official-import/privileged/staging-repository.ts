import "server-only";
import type {
  EventDurableCandidate,
  TicketOpportunityDurableCandidate,
} from "@stage-tracker/official-import/durable-candidate";
import { parseCanonicalProposal } from "@stage-tracker/official-import/durable-candidate";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/data/database.types";
import { deriveOfficialImportCandidateReviewStatus } from "../candidate-review";
import type {
  OfficialImportStagingRepository,
  RunFailureClassification,
  RunPreparation,
} from "../shadow-execution";
import { createPrivilegedIngestionClient } from "./supabase";

function candidateBatchPayload(
  candidate: EventDurableCandidate | TicketOpportunityDurableCandidate,
): Json {
  return {
    candidate_kind: candidate.candidateKind,
    canonical_url: candidate.canonicalUrl,
    official_external_id: candidate.officialExternalId,
    observed_at: candidate.observedAt,
    content_hash: candidate.contentHash,
    etag: candidate.etag,
    last_modified: candidate.lastModified,
    evidence_locator: candidate.evidenceLocator,
    deterministic_match_status: candidate.deterministicMatchStatus,
    semantic_match_status: candidate.semanticMatchStatus,
    resolved_event_id: candidate.resolvedEventId,
    resolved_ticket_opportunity_id: candidate.resolvedTicketOpportunityId,
    jev_decision_evidence: candidate.jevDecisionEvidence,
    plan_summary: candidate.planSummary,
    plan_fingerprint: candidate.planFingerprint,
    proposal_version: candidate.proposalVersion,
    proposal: parseCanonicalProposal(
      candidate.candidateKind,
      candidate.proposalVersion,
      candidate.proposal,
    ),
    review_status: deriveOfficialImportCandidateReviewStatus(candidate),
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

    return { status: "ready" };
  }

  async commitCandidates(
    runId: string,
    sourceId: string,
    candidates: readonly (
      EventDurableCandidate | TicketOpportunityDurableCandidate
    )[],
  ): Promise<number> {
    if (
      candidates.some(
        (candidate) =>
          candidate.runId !== runId || candidate.sourceId !== sourceId,
      )
    )
      throw new Error(
        "Official import candidate batch identity does not match",
      );

    const { data, error } = await this.client.rpc(
      "commit_official_import_candidate_batch",
      {
        p_run_id: runId,
        p_source_id: sourceId,
        p_candidates: candidates.map(candidateBatchPayload),
      },
    );
    if (error !== null || data === null)
      throw new Error("Failed to publish official import candidate batch");
    return data;
  }

  async failRun(
    runId: string,
    classification: RunFailureClassification,
  ): Promise<void> {
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
