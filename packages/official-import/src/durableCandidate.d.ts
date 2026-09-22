export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue | undefined };
export type JsonObject = { [key: string]: JsonValue | undefined };

export const EVENT_PROPOSAL_VERSION: 'event.v1';
export const TICKET_OPPORTUNITY_PROPOSAL_VERSION: 'ticket_opportunity.v1';

export class DurableCandidateValidationError extends Error {}

export interface EvidenceLocatorInput {
  pdfPageNumber?: number;
  sectionLabel?: string;
  rowLabel?: string;
  fragmentId?: string;
}

export interface JevDecisionEvidenceInput {
  decisionKind: string;
  version: string;
  provider: string;
  model: string;
  choice: string;
  confidence?: number;
  referencedCandidateIds?: string[];
  inputFingerprint: string;
}

export interface EventProposalInput {
  sourceKey: string;
  title: string;
  venue?: string | null;
  memo?: string | null;
  sourceUrl?: string | null;
  startsOn: string;
  endsOn: string;
  occurrences: Array<{ doorsAt?: string | null; startsAt: string; endsAt?: string | null }>;
  genre?: string | null;
  groups?: Array<{ key: string; displayName: string }>;
}

export interface TicketOpportunityProposalInput {
  eventSourceKey: string;
  sourceKey: string;
  displayName: string;
  sourceUrl?: string | null;
  memo?: string | null;
  targetScope: 'event_wide' | 'selected_occurrences';
  targetOccurrences?: string[];
  milestones?: Array<
    | { type: string; precision: 'date'; date: string }
    | { type: string; precision: 'datetime'; at: string }
    | { type: string; precision: 'window'; startsAt: string; endsAt: string }
  >;
}

export interface EventPlanInput {
  action: 'create' | 'update' | 'unchanged';
  detailsChanged: boolean;
  rangeChanged: boolean;
  newOccurrences?: readonly unknown[];
  endsAtFixes?: readonly unknown[];
  doorsAtFixes?: readonly unknown[];
  keptOccurrences?: number;
  genrePlan?: { changed?: boolean };
  groupsPlan?: { changed?: boolean };
}

export interface TicketOpportunityPlanInput {
  action: 'create' | 'update' | 'unchanged';
  eventChanged: boolean;
  detailsChanged: boolean;
  occurrencesChanged: boolean;
  milestonesChanged: boolean;
  occurrenceIds?: readonly unknown[];
  milestones?: readonly unknown[];
}

interface CandidateInputCommon {
  runId: string;
  sourceId: string;
  canonicalUrl: string;
  officialExternalId?: string | null | undefined;
  observedAt: string;
  contentHash: string;
  etag?: string | null | undefined;
  lastModified?: string | null | undefined;
  evidenceLocator?: EvidenceLocatorInput | undefined;
  deterministicMatchStatus?: 'unresolved' | 'matched' | 'unmatched' | 'ambiguous' | undefined;
  semanticMatchStatus?:
    'not_used' | 'matched' | 'unmatched' | 'ambiguous' | 'low_confidence' | undefined;
  resolvedEventId?: string | null | undefined;
  resolvedTicketOpportunityId?: string | null | undefined;
  jevDecisionEvidence?: JevDecisionEvidenceInput | null | undefined;
  planFingerprint: string;
}

export interface EventCandidateInput extends CandidateInputCommon {
  proposal: EventProposalInput;
  plan: EventPlanInput;
}

export interface TicketOpportunityCandidateInput extends CandidateInputCommon {
  proposal: TicketOpportunityProposalInput;
  plan: TicketOpportunityPlanInput;
}

interface DurableCandidateCommon {
  runId: string;
  sourceId: string;
  canonicalUrl: string;
  officialExternalId: string | null;
  observedAt: string;
  contentHash: string;
  etag: string | null;
  lastModified: string | null;
  evidenceLocator: JsonObject;
  deterministicMatchStatus: 'unresolved' | 'matched' | 'unmatched' | 'ambiguous';
  semanticMatchStatus: 'not_used' | 'matched' | 'unmatched' | 'ambiguous' | 'low_confidence';
  resolvedEventId: string | null;
  resolvedTicketOpportunityId: string | null;
  jevDecisionEvidence: JsonObject | null;
  planSummary: JsonObject;
  planFingerprint: string;
}

export interface EventDurableCandidate extends DurableCandidateCommon {
  candidateKind: 'event';
  proposalVersion: 'event.v1';
  proposal: JsonObject;
}

export interface TicketOpportunityDurableCandidate extends DurableCandidateCommon {
  candidateKind: 'ticket_opportunity';
  proposalVersion: 'ticket_opportunity.v1';
  proposal: JsonObject;
}

export function parseCanonicalProposal(
  candidateKind: string,
  proposalVersion: string,
  raw: unknown,
): JsonObject;
export function createEventProposal(raw: EventProposalInput): EventProposalInput & JsonObject;
export function createTicketOpportunityProposal(
  raw: TicketOpportunityProposalInput,
): TicketOpportunityProposalInput & JsonObject;
export function createEvidenceLocator(raw?: EvidenceLocatorInput): JsonObject;
export function createJevDecisionEvidence(raw?: JevDecisionEvidenceInput | null): JsonObject | null;
export function createEventPlanSummary(plan: EventPlanInput): JsonObject;
export function createTicketOpportunityPlanSummary(plan: TicketOpportunityPlanInput): JsonObject;
export function createEventDurableCandidate(input: EventCandidateInput): EventDurableCandidate;
export function createTicketOpportunityDurableCandidate(
  input: TicketOpportunityCandidateInput,
): TicketOpportunityDurableCandidate;
