import type {
  EventPlanInput,
  EventProposalInput,
  EvidenceLocatorInput,
  JevDecisionEvidenceInput,
  TicketOpportunityPlanInput,
  TicketOpportunityProposalInput,
} from "@stage-tracker/official-import/durable-candidate";
import type { OfficialSourceDefinition } from "./source-registry";

interface AcquisitionMetadata {
  readonly canonicalUrl: string;
  readonly officialExternalId?: string | null | undefined;
  readonly observedAt: string;
  readonly contentHash: string;
  readonly etag?: string | null | undefined;
  readonly lastModified?: string | null | undefined;
  readonly evidenceLocator?: EvidenceLocatorInput | undefined;
}

export interface EventAcquisitionDraft extends AcquisitionMetadata {
  readonly candidateKind: "event";
  readonly proposal: EventProposalInput;
}

export interface TicketOpportunityAcquisitionDraft extends AcquisitionMetadata {
  readonly candidateKind: "ticket_opportunity";
  readonly proposal: TicketOpportunityProposalInput;
}

export type AcquisitionDraft =
  EventAcquisitionDraft | TicketOpportunityAcquisitionDraft;

/**
 * Implementations own fetch and parsing together. Raw bodies, PDF bytes,
 * converted Markdown, DOM snapshots, and provider responses must remain local
 * to this call and must never appear in its return type.
 */
export interface OfficialSourceAdapter {
  acquire(
    source: OfficialSourceDefinition,
  ): Promise<readonly AcquisitionDraft[]>;
}

interface PlannedCandidateMetadata {
  readonly planFingerprint: string;
  readonly deterministicMatchStatus?:
    "unresolved" | "matched" | "unmatched" | "ambiguous";
  readonly semanticMatchStatus?:
    "not_used" | "matched" | "unmatched" | "ambiguous" | "low_confidence";
  readonly resolvedEventId?: string | null;
  readonly resolvedTicketOpportunityId?: string | null;
  readonly jevDecisionEvidence?: JevDecisionEvidenceInput | null;
}

export interface EventPlanningResult extends PlannedCandidateMetadata {
  readonly plan: EventPlanInput;
}

export interface TicketOpportunityPlanningResult extends PlannedCandidateMetadata {
  readonly plan: TicketOpportunityPlanInput;
}

export interface OfficialImportCandidatePlanner {
  planEvent(
    source: OfficialSourceDefinition,
    draft: EventAcquisitionDraft,
  ): Promise<EventPlanningResult>;
  planTicketOpportunity(
    source: OfficialSourceDefinition,
    draft: TicketOpportunityAcquisitionDraft,
  ): Promise<TicketOpportunityPlanningResult>;
}

export class SourceFetchFailure extends Error {
  constructor() {
    super("Official source fetch failed");
    this.name = "SourceFetchFailure";
  }
}

export class SourceParseFailure extends Error {
  constructor() {
    super("Official source parse failed");
    this.name = "SourceParseFailure";
  }
}

export class ProviderUnavailableFailure extends Error {
  constructor() {
    super("Official source adapter is not available");
    this.name = "ProviderUnavailableFailure";
  }
}
