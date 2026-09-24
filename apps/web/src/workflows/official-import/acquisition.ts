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
  /**
   * Source-provided Event facts used only while planning. They are deliberately
   * excluded from the durable proposal; a resolved catalog Event source key is
   * written back by the planner, and an unresolved draft remains review-blocked.
   */
  readonly eventReference?: {
    readonly title: string;
    readonly venue?: string | null;
    readonly startsOn: string;
    readonly endsOn: string;
  };
}

export type AcquisitionDraft =
  EventAcquisitionDraft | TicketOpportunityAcquisitionDraft;

/** Compact page identity only; never include a raw response or parse error. */
export interface HeldSourcePage {
  readonly canonicalUrl: string;
  readonly officialExternalId: string;
  readonly title: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly reasonCode: "source_parse" | "published_end_missing";
}

/**
 * Implementations own fetch and parsing together. Raw bodies, PDF bytes,
 * converted Markdown, DOM snapshots, and provider responses must remain local
 * to this call and must never appear in its return type.
 */
export interface OfficialSourceAdapter {
  acquire(
    source: OfficialSourceDefinition,
    reportHeldPage?: (page: HeldSourcePage) => void,
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
  readonly holdReason?: "published_end_missing";
}

export interface TicketOpportunityPlanningResult extends PlannedCandidateMetadata {
  readonly plan: TicketOpportunityPlanInput;
  readonly proposal?: TicketOpportunityProposalInput;
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
