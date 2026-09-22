import { validateEventEntry } from './eventImport.mjs';
import { validateSeedEntryShape } from './ticketOpportunitySeed.mjs';

export const EVENT_PROPOSAL_VERSION = 'event.v1';
export const TICKET_OPPORTUNITY_PROPOSAL_VERSION = 'ticket_opportunity.v1';

const SHA256 = /^[0-9a-f]{64}$/;
const EVENT_ACTIONS = new Set(['create', 'update', 'unchanged']);
const TICKET_ACTIONS = new Set(['create', 'update', 'unchanged']);
const DETERMINISTIC_MATCH_STATUSES = new Set(['unresolved', 'matched', 'unmatched', 'ambiguous']);
const SEMANTIC_MATCH_STATUSES = new Set([
  'not_used',
  'matched',
  'unmatched',
  'ambiguous',
  'low_confidence',
]);

export class DurableCandidateValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DurableCandidateValidationError';
  }
}

function object(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DurableCandidateValidationError(`${name} must be an object`);
  }
  return value;
}

function boundedText(value, name, { nullable = false, max = 512 } = {}) {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DurableCandidateValidationError(`${name} must be a non-empty string`);
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw new DurableCandidateValidationError(`${name} must be at most ${max} characters`);
  }
  return normalized;
}

function optionalBoundedText(value, name, max) {
  return value === null || value === undefined
    ? null
    : boundedText(value, name, { nullable: false, max });
}

function strictKeys(value, allowed, name) {
  const raw = object(value, name);
  const unexpected = Object.keys(raw).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new DurableCandidateValidationError(
      `${name} contains unsupported fields: ${unexpected.sort().join(', ')}`,
    );
  }
  return raw;
}

function canonicalEventProposal(raw) {
  const result = validateEventEntry(raw, 'official import proposal');
  if (!result.ok) throw new DurableCandidateValidationError(result.problems.join('\n'));
  const { entry } = result;
  const proposal = {
    sourceKey: entry.sourceKey,
    title: entry.title,
    venue: entry.venue,
    memo: entry.memo,
    sourceUrl: entry.sourceUrl,
    startsOn: entry.startsOn,
    endsOn: entry.endsOn,
    occurrences: entry.occurrences.map(({ doorsAt, startsAt, endsAt }) => ({
      doorsAt,
      startsAt,
      endsAt,
    })),
  };
  if (entry.classification.genre !== undefined) proposal.genre = entry.classification.genre;
  if (entry.classification.groups !== undefined) {
    proposal.groups = entry.classification.groups.map(({ key, displayName }) => ({
      key,
      displayName,
    }));
  }
  return proposal;
}

export function createEventProposal(raw) {
  return canonicalEventProposal(raw);
}

function canonicalMilestone(milestone) {
  if (milestone.temporal_precision === 'date') {
    return {
      type: milestone.milestone_type,
      precision: milestone.temporal_precision,
      date: milestone.date_value,
    };
  }
  if (milestone.temporal_precision === 'datetime') {
    return {
      type: milestone.milestone_type,
      precision: milestone.temporal_precision,
      at: milestone.at,
    };
  }
  return {
    type: milestone.milestone_type,
    precision: milestone.temporal_precision,
    startsAt: milestone.starts_at,
    endsAt: milestone.ends_at,
  };
}

function canonicalTicketOpportunityProposal(raw) {
  const result = validateSeedEntryShape(raw, 'official import proposal');
  if (!result.ok) throw new DurableCandidateValidationError(result.problems.join('\n'));
  const { entry } = result;
  return {
    eventSourceKey: entry.eventSourceKey,
    sourceKey: entry.sourceKey,
    displayName: entry.displayName,
    sourceUrl: entry.sourceUrl,
    memo: entry.memo,
    targetScope: entry.targetScope,
    targetOccurrences: [...entry.targetOccurrences],
    milestones: entry.milestones.map(canonicalMilestone),
  };
}

export function createTicketOpportunityProposal(raw) {
  return canonicalTicketOpportunityProposal(raw);
}

export function parseCanonicalProposal(candidateKind, proposalVersion, raw) {
  if (candidateKind === 'event' && proposalVersion === EVENT_PROPOSAL_VERSION) {
    return canonicalEventProposal(raw);
  }
  if (
    candidateKind === 'ticket_opportunity' &&
    proposalVersion === TICKET_OPPORTUNITY_PROPOSAL_VERSION
  ) {
    return canonicalTicketOpportunityProposal(raw);
  }
  throw new DurableCandidateValidationError(
    `unsupported candidate kind/version pair: ${String(candidateKind)} + ${String(proposalVersion)}`,
  );
}

export function createEvidenceLocator(raw = {}) {
  const value = strictKeys(
    raw,
    new Set(['pdfPageNumber', 'sectionLabel', 'rowLabel', 'fragmentId']),
    'evidenceLocator',
  );
  const locator = {};
  if (value.pdfPageNumber !== undefined) {
    if (!Number.isInteger(value.pdfPageNumber) || value.pdfPageNumber < 1) {
      throw new DurableCandidateValidationError(
        'evidenceLocator.pdfPageNumber must be a positive integer',
      );
    }
    locator.pdfPageNumber = value.pdfPageNumber;
  }
  for (const key of ['sectionLabel', 'rowLabel', 'fragmentId']) {
    if (value[key] !== undefined) locator[key] = boundedText(value[key], `evidenceLocator.${key}`);
  }
  return locator;
}

export function createJevDecisionEvidence(raw) {
  if (raw === null || raw === undefined) return null;
  const value = strictKeys(
    raw,
    new Set([
      'decisionKind',
      'version',
      'provider',
      'model',
      'choice',
      'confidence',
      'referencedCandidateIds',
      'inputFingerprint',
    ]),
    'jevDecisionEvidence',
  );
  const evidence = {
    decisionKind: boundedText(value.decisionKind, 'jevDecisionEvidence.decisionKind', { max: 64 }),
    version: boundedText(value.version, 'jevDecisionEvidence.version', { max: 32 }),
    provider: boundedText(value.provider, 'jevDecisionEvidence.provider', { max: 64 }),
    model: boundedText(value.model, 'jevDecisionEvidence.model', { max: 128 }),
    choice: boundedText(value.choice, 'jevDecisionEvidence.choice', { max: 128 }),
    inputFingerprint: boundedText(value.inputFingerprint, 'jevDecisionEvidence.inputFingerprint', {
      max: 128,
    }),
  };
  if (value.confidence !== undefined) {
    if (
      typeof value.confidence !== 'number' ||
      !Number.isFinite(value.confidence) ||
      value.confidence < 0 ||
      value.confidence > 1
    ) {
      throw new DurableCandidateValidationError(
        'jevDecisionEvidence.confidence must be between 0 and 1',
      );
    }
    evidence.confidence = value.confidence;
  }
  if (value.referencedCandidateIds !== undefined) {
    if (!Array.isArray(value.referencedCandidateIds) || value.referencedCandidateIds.length > 20) {
      throw new DurableCandidateValidationError(
        'jevDecisionEvidence.referencedCandidateIds must be an array of at most 20 ids',
      );
    }
    evidence.referencedCandidateIds = value.referencedCandidateIds.map((id, index) =>
      boundedText(id, `jevDecisionEvidence.referencedCandidateIds[${index}]`, { max: 128 }),
    );
  }
  return evidence;
}

function boolean(value, name) {
  if (typeof value !== 'boolean') {
    throw new DurableCandidateValidationError(`${name} must be boolean`);
  }
  return value;
}

function count(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 100000) {
    throw new DurableCandidateValidationError(`${name} must be a bounded non-negative integer`);
  }
  return value;
}

export function createEventPlanSummary(plan) {
  const value = object(plan, 'eventPlan');
  if (!EVENT_ACTIONS.has(value.action)) {
    throw new DurableCandidateValidationError('eventPlan.action is unsupported');
  }
  return {
    version: 'event_plan.v1',
    action: value.action,
    detailsChanged: boolean(value.detailsChanged, 'eventPlan.detailsChanged'),
    rangeChanged: boolean(value.rangeChanged, 'eventPlan.rangeChanged'),
    newOccurrenceCount: count(value.newOccurrences?.length ?? 0, 'eventPlan.newOccurrenceCount'),
    endsAtFixCount: count(value.endsAtFixes?.length ?? 0, 'eventPlan.endsAtFixCount'),
    doorsAtFixCount: count(value.doorsAtFixes?.length ?? 0, 'eventPlan.doorsAtFixCount'),
    keptOccurrenceCount: count(value.keptOccurrences ?? 0, 'eventPlan.keptOccurrenceCount'),
    genreChanged: boolean(value.genrePlan?.changed ?? false, 'eventPlan.genreChanged'),
    groupsChanged: boolean(value.groupsPlan?.changed ?? false, 'eventPlan.groupsChanged'),
  };
}

export function createTicketOpportunityPlanSummary(plan) {
  const value = object(plan, 'ticketOpportunityPlan');
  if (!TICKET_ACTIONS.has(value.action)) {
    throw new DurableCandidateValidationError('ticketOpportunityPlan.action is unsupported');
  }
  return {
    version: 'ticket_opportunity_plan.v1',
    action: value.action,
    eventChanged: boolean(value.eventChanged, 'ticketOpportunityPlan.eventChanged'),
    detailsChanged: boolean(value.detailsChanged, 'ticketOpportunityPlan.detailsChanged'),
    occurrencesChanged: boolean(
      value.occurrencesChanged,
      'ticketOpportunityPlan.occurrencesChanged',
    ),
    milestonesChanged: boolean(value.milestonesChanged, 'ticketOpportunityPlan.milestonesChanged'),
    targetOccurrenceCount: count(
      value.occurrenceIds?.length ?? 0,
      'ticketOpportunityPlan.targetOccurrenceCount',
    ),
    milestoneCount: count(value.milestones?.length ?? 0, 'ticketOpportunityPlan.milestoneCount'),
  };
}

function commonCandidate(input, candidateKind, proposalVersion, proposal, planSummary) {
  const value = object(input, `${candidateKind}Candidate`);
  const canonicalUrl = boundedText(value.canonicalUrl, 'canonicalUrl', { max: 2048 });
  let parsedUrl;
  try {
    parsedUrl = new URL(canonicalUrl);
  } catch {
    throw new DurableCandidateValidationError('canonicalUrl must be an absolute URL');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new DurableCandidateValidationError('canonicalUrl must use http or https');
  }
  const observedAt = boundedText(value.observedAt, 'observedAt', { max: 64 });
  if (Number.isNaN(Date.parse(observedAt))) {
    throw new DurableCandidateValidationError('observedAt must be a parseable timestamp');
  }
  const contentHash = boundedText(value.contentHash, 'contentHash', { max: 64 });
  if (!SHA256.test(contentHash)) {
    throw new DurableCandidateValidationError('contentHash must be a lowercase SHA-256 hex digest');
  }
  const deterministicMatchStatus = value.deterministicMatchStatus ?? 'unresolved';
  const semanticMatchStatus = value.semanticMatchStatus ?? 'not_used';
  if (!DETERMINISTIC_MATCH_STATUSES.has(deterministicMatchStatus)) {
    throw new DurableCandidateValidationError('deterministicMatchStatus is unsupported');
  }
  if (!SEMANTIC_MATCH_STATUSES.has(semanticMatchStatus)) {
    throw new DurableCandidateValidationError('semanticMatchStatus is unsupported');
  }
  return {
    runId: boundedText(value.runId, 'runId', { max: 128 }),
    sourceId: boundedText(value.sourceId, 'sourceId', { max: 128 }),
    candidateKind,
    canonicalUrl,
    officialExternalId: optionalBoundedText(value.officialExternalId, 'officialExternalId', 512),
    observedAt,
    contentHash,
    etag: optionalBoundedText(value.etag, 'etag', 512),
    lastModified: optionalBoundedText(value.lastModified, 'lastModified', 128),
    proposalVersion,
    proposal,
    evidenceLocator: createEvidenceLocator(value.evidenceLocator),
    deterministicMatchStatus,
    semanticMatchStatus,
    resolvedEventId: optionalBoundedText(value.resolvedEventId, 'resolvedEventId', 128),
    resolvedTicketOpportunityId: optionalBoundedText(
      value.resolvedTicketOpportunityId,
      'resolvedTicketOpportunityId',
      128,
    ),
    jevDecisionEvidence: createJevDecisionEvidence(value.jevDecisionEvidence),
    planSummary,
    planFingerprint: boundedText(value.planFingerprint, 'planFingerprint', { max: 128 }),
  };
}

export function createEventDurableCandidate(input) {
  const value = object(input, 'eventCandidate');
  return commonCandidate(
    value,
    'event',
    EVENT_PROPOSAL_VERSION,
    canonicalEventProposal(value.proposal),
    createEventPlanSummary(value.plan),
  );
}

export function createTicketOpportunityDurableCandidate(input) {
  const value = object(input, 'ticketOpportunityCandidate');
  return commonCandidate(
    value,
    'ticket_opportunity',
    TICKET_OPPORTUNITY_PROPOSAL_VERSION,
    canonicalTicketOpportunityProposal(value.proposal),
    createTicketOpportunityPlanSummary(value.plan),
  );
}
