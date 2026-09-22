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

class SupabaseOfficialImportStagingRepository implements OfficialImportStagingRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async createRun(sourceId: string): Promise<string> {
    const { data, error } = await this.client
      .from("official_import_runs")
      .insert({ source_id: sourceId })
      .select("id")
      .single();
    if (error !== null || data === null)
      throw new Error("Failed to create official import run");
    return data.id;
  }

  async insertEventCandidate(candidate: EventDurableCandidate): Promise<void> {
    const proposal = parseCanonicalProposal(
      candidate.candidateKind,
      candidate.proposalVersion,
      candidate.proposal,
    );
    const { error } = await this.client
      .from("official_import_candidates")
      .insert({
        ...commonInsertFields(candidate),
        candidate_kind: candidate.candidateKind,
        proposal_version: candidate.proposalVersion,
        proposal,
      });
    if (error !== null)
      throw new Error("Failed to stage official Event candidate");
  }

  async insertTicketOpportunityCandidate(
    candidate: TicketOpportunityDurableCandidate,
  ): Promise<void> {
    const proposal = parseCanonicalProposal(
      candidate.candidateKind,
      candidate.proposalVersion,
      candidate.proposal,
    );
    const { error } = await this.client
      .from("official_import_candidates")
      .insert({
        ...commonInsertFields(candidate),
        candidate_kind: candidate.candidateKind,
        proposal_version: candidate.proposalVersion,
        proposal,
      });
    if (error !== null)
      throw new Error("Failed to stage official TicketOpportunity candidate");
  }

  async completeRun(runId: string): Promise<void> {
    const { error } = await this.client
      .from("official_import_runs")
      .update({ status: "completed", finished_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("status", "running");
    if (error !== null)
      throw new Error("Failed to complete official import run");
  }

  async failRun(
    runId: string,
    classification: RunFailureClassification,
  ): Promise<void> {
    const { error } = await this.client
      .from("official_import_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        failure_classification: classification,
      })
      .eq("id", runId)
      .eq("status", "running");
    if (error !== null)
      throw new Error("Failed to record official import run failure");
  }
}

export function createOfficialImportStagingRepository(): OfficialImportStagingRepository {
  return new SupabaseOfficialImportStagingRepository(
    createPrivilegedIngestionClient(),
  );
}
