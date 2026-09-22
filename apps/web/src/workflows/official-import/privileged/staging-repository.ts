import "server-only";
import type {
  EventDurableCandidate,
  TicketOpportunityDurableCandidate,
} from "@stage-tracker/official-import/durable-candidate";
import { parseCanonicalProposal } from "@stage-tracker/official-import/durable-candidate";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/data/database.types";
import { deriveOfficialImportCandidateReviewStatus } from "../candidate-review";
import {
  OFFICIAL_IMPORT_ATTEMPT_LEASE_SECONDS,
  OfficialImportAttemptRetryError,
  type OfficialImportStagingRepository,
  type RunAttemptTransition,
  type RunFailureClassification,
  type RunPreparation,
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

function parseAttemptTransition(value: string): RunAttemptTransition {
  if (
    value === "released" ||
    value === "not_owner" ||
    value === "completed" ||
    value === "failed"
  )
    return value;
  throw new Error("Official import attempt has an invalid transition");
}

class SupabaseOfficialImportStagingRepository implements OfficialImportStagingRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async prepareRun(
    runId: string,
    sourceId: string,
    attemptToken: string,
  ): Promise<RunPreparation> {
    const { data: claimStatus, error } = await this.client.rpc(
      "claim_official_import_run_attempt",
      {
        p_run_id: runId,
        p_source_id: sourceId,
        p_attempt_token: attemptToken,
        p_lease_seconds: OFFICIAL_IMPORT_ATTEMPT_LEASE_SECONDS,
      },
    );
    if (error !== null || claimStatus === null)
      throw new Error("Failed to claim official import run attempt");

    if (claimStatus === "claimed") return { status: "ready" };
    if (claimStatus === "busy") return { status: "busy" };
    if (claimStatus === "completed") {
      const { count, error: countError } = await this.client
        .from("official_import_candidates")
        .select("id", { count: "exact", head: true })
        .eq("run_id", runId);
      if (countError !== null || count === null)
        throw new Error("Failed to read completed official import run");
      return { status: "completed", candidateCount: count };
    }
    if (claimStatus === "failed") {
      const { data, error: readError } = await this.client
        .from("official_import_runs")
        .select("failure_classification")
        .eq("id", runId)
        .eq("source_id", sourceId)
        .single();
      if (readError !== null || data === null)
        throw new Error("Failed to read failed official import run");
      return {
        status: "failed",
        failureClassification: parseFailureClassification(
          data.failure_classification,
        ),
      };
    }
    throw new Error("Official import attempt claim has an invalid status");
  }

  async commitCandidates(
    runId: string,
    sourceId: string,
    attemptToken: string,
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
      "commit_owned_official_import_candidate_batch",
      {
        p_run_id: runId,
        p_source_id: sourceId,
        p_attempt_token: attemptToken,
        p_candidates: candidates.map(candidateBatchPayload),
      },
    );
    if (error?.code === "55000")
      throw new OfficialImportAttemptRetryError("ownership_lost");
    if (error !== null || data === null)
      throw new Error("Failed to publish official import candidate batch");
    return data;
  }

  async releaseRun(
    runId: string,
    sourceId: string,
    attemptToken: string,
  ): Promise<RunAttemptTransition> {
    const { data, error } = await this.client.rpc(
      "release_official_import_run_attempt",
      {
        p_run_id: runId,
        p_source_id: sourceId,
        p_attempt_token: attemptToken,
      },
    );
    if (error !== null || data === null)
      throw new Error("Failed to release official import run attempt");
    return parseAttemptTransition(data);
  }

  async failRun(
    runId: string,
    sourceId: string,
    attemptToken: string,
    classification: RunFailureClassification,
  ): Promise<RunAttemptTransition> {
    const { data, error } = await this.client.rpc(
      "fail_official_import_run_attempt",
      {
        p_run_id: runId,
        p_source_id: sourceId,
        p_attempt_token: attemptToken,
        p_failure_classification: classification,
      },
    );
    if (error !== null || data === null)
      throw new Error("Failed to record official import run failure");
    return parseAttemptTransition(data);
  }
}

export function createOfficialImportStagingRepository(): OfficialImportStagingRepository {
  return new SupabaseOfficialImportStagingRepository(
    createPrivilegedIngestionClient(),
  );
}
