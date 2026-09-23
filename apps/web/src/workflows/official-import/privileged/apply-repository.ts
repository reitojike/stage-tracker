import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/data/database.types";
import {
  OFFICIAL_IMPORT_APPLY_LEASE_SECONDS,
  type CandidateApplyFailureClassification,
  type CandidateApplyPreparation,
  type CandidateApplyTransition,
  type OfficialImportApplyCandidate,
  type OfficialImportApplyRepository,
} from "../apply-execution";
import { createPrivilegedIngestionClient } from "./supabase";

const CANDIDATE_SELECT =
  "id, source_id, candidate_kind, canonical_url, official_external_id, observed_at, content_hash, etag, last_modified, proposal_version, proposal, evidence_locator, plan_fingerprint, deterministic_match_status, semantic_match_status, resolved_event_id, resolved_ticket_opportunity_id, reviewer, review_status, apply_status, active_apply_attempt_token";

type CandidateRow = Pick<
  Database["public"]["Tables"]["official_import_candidates"]["Row"],
  | "id"
  | "source_id"
  | "candidate_kind"
  | "canonical_url"
  | "official_external_id"
  | "observed_at"
  | "content_hash"
  | "etag"
  | "last_modified"
  | "proposal_version"
  | "proposal"
  | "evidence_locator"
  | "plan_fingerprint"
  | "deterministic_match_status"
  | "semantic_match_status"
  | "resolved_event_id"
  | "resolved_ticket_opportunity_id"
  | "reviewer"
  | "review_status"
  | "apply_status"
  | "active_apply_attempt_token"
>;

function isDeterministicMatchStatus(
  value: string,
): value is OfficialImportApplyCandidate["deterministicMatchStatus"] {
  return ["unresolved", "matched", "unmatched", "ambiguous"].includes(value);
}

function isSemanticMatchStatus(
  value: string,
): value is OfficialImportApplyCandidate["semanticMatchStatus"] {
  return [
    "not_used",
    "matched",
    "unmatched",
    "ambiguous",
    "low_confidence",
  ].includes(value);
}

function parseTransition(value: string): CandidateApplyTransition {
  if (
    value === "applied" ||
    value === "failed" ||
    value === "not_owner" ||
    value === "not_started" ||
    value === "queued"
  ) {
    return value;
  }
  throw new Error("Official import candidate apply has an invalid transition");
}

function parseCandidate(
  row: CandidateRow,
  attemptToken: string,
): OfficialImportApplyCandidate {
  const deterministicMatchStatus = row.deterministic_match_status;
  const semanticMatchStatus = row.semantic_match_status;
  if (
    row.review_status !== "approved" ||
    row.reviewer === null ||
    row.apply_status !== "queued" ||
    row.active_apply_attempt_token !== attemptToken ||
    (row.candidate_kind !== "event" &&
      row.candidate_kind !== "ticket_opportunity") ||
    !isDeterministicMatchStatus(deterministicMatchStatus) ||
    !isSemanticMatchStatus(semanticMatchStatus)
  ) {
    throw new Error("Official import candidate apply state is invalid");
  }
  return {
    id: row.id,
    sourceId: row.source_id,
    candidateKind: row.candidate_kind,
    canonicalUrl: row.canonical_url,
    officialExternalId: row.official_external_id,
    observedAt: row.observed_at,
    contentHash: row.content_hash,
    etag: row.etag,
    lastModified: row.last_modified,
    proposalVersion: row.proposal_version,
    proposal: row.proposal,
    evidenceLocator: row.evidence_locator,
    planFingerprint: row.plan_fingerprint,
    deterministicMatchStatus,
    semanticMatchStatus,
    resolvedEventId: row.resolved_event_id,
    resolvedTicketOpportunityId: row.resolved_ticket_opportunity_id,
    reviewerId: row.reviewer,
  };
}

class SupabaseOfficialImportApplyRepository implements OfficialImportApplyRepository {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async prepareCandidate(
    candidateId: string,
    attemptToken: string,
  ): Promise<CandidateApplyPreparation> {
    const { data: claimStatus, error } = await this.client.rpc(
      "claim_official_import_candidate_apply",
      {
        p_candidate_id: candidateId,
        p_attempt_token: attemptToken,
        p_lease_seconds: OFFICIAL_IMPORT_APPLY_LEASE_SECONDS,
      },
    );
    if (error !== null || claimStatus === null) {
      throw new Error("Failed to claim official import candidate apply");
    }
    if (claimStatus === "busy") return { status: "busy" };
    if (claimStatus === "applied") return { status: "applied" };
    if (claimStatus === "not_approved") return { status: "not_approved" };
    if (claimStatus !== "claimed") {
      throw new Error("Official import candidate apply claim is invalid");
    }

    const { data, error: readError } = await this.client
      .from("official_import_candidates")
      .select(CANDIDATE_SELECT)
      .eq("id", candidateId)
      .single();
    if (readError !== null || data === null) {
      throw new Error("Failed to read claimed official import candidate");
    }
    return {
      status: "ready",
      candidate: parseCandidate(data, attemptToken),
    };
  }

  async completeCandidate(
    candidateId: string,
    attemptToken: string,
  ): Promise<CandidateApplyTransition> {
    const { data, error } = await this.client.rpc(
      "complete_official_import_candidate_apply",
      {
        p_candidate_id: candidateId,
        p_attempt_token: attemptToken,
      },
    );
    if (error !== null || data === null) {
      throw new Error("Failed to complete official import candidate apply");
    }
    return parseTransition(data);
  }

  async failCandidate(
    candidateId: string,
    attemptToken: string,
    classification: CandidateApplyFailureClassification,
  ): Promise<CandidateApplyTransition> {
    const { data, error } = await this.client.rpc(
      "fail_official_import_candidate_apply",
      {
        p_candidate_id: candidateId,
        p_attempt_token: attemptToken,
        p_failure_classification: classification,
      },
    );
    if (error !== null || data === null) {
      throw new Error("Failed to record official import candidate failure");
    }
    return parseTransition(data);
  }
}

export function createOfficialImportApplyRepository(
  client: SupabaseClient<Database> = createPrivilegedIngestionClient(),
): OfficialImportApplyRepository {
  return new SupabaseOfficialImportApplyRepository(client);
}
