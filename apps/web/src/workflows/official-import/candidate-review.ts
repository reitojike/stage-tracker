import type {
  EventDurableCandidate,
  TicketOpportunityDurableCandidate,
} from "@stage-tracker/official-import/durable-candidate";

type MatchEvidence = Pick<
  EventDurableCandidate | TicketOpportunityDurableCandidate,
  "deterministicMatchStatus" | "semanticMatchStatus"
>;

export type OfficialImportCandidateReviewStatus =
  "pending" | "blocked_for_identity_review";

export function deriveOfficialImportCandidateReviewStatus(
  candidate: MatchEvidence,
): OfficialImportCandidateReviewStatus {
  return candidate.deterministicMatchStatus === "ambiguous" ||
    candidate.semanticMatchStatus === "ambiguous" ||
    candidate.semanticMatchStatus === "low_confidence"
    ? "blocked_for_identity_review"
    : "pending";
}
