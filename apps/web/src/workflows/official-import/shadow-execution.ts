import {
  createEventDurableCandidate,
  createEventProposal,
  createEvidenceLocator,
  createTicketOpportunityProposal,
  createTicketOpportunityDurableCandidate,
  DurableCandidateValidationError,
  type EventDurableCandidate,
  type TicketOpportunityDurableCandidate,
} from "@stage-tracker/official-import/durable-candidate";
import {
  ProviderUnavailableFailure,
  SourceFetchFailure,
  SourceParseFailure,
  type OfficialImportCandidatePlanner,
  type OfficialSourceAdapter,
} from "./acquisition";
import {
  OfficialSourceRegistryError,
  assertAllowedSourceUrl,
  type OfficialSourceDefinition,
} from "./source-registry";

export type RunFailureClassification =
  | "source_fetch"
  | "source_parse"
  | "provider_unavailable"
  | "validation"
  | "unexpected";

export type RunPreparation =
  | { readonly status: "ready" }
  | { readonly status: "completed"; readonly candidateCount: number }
  | {
      readonly status: "failed";
      readonly failureClassification: RunFailureClassification;
    };

export interface OfficialImportStagingRepository {
  prepareRun(runId: string, sourceId: string): Promise<RunPreparation>;
  commitCandidates(
    runId: string,
    sourceId: string,
    candidates: readonly (
      EventDurableCandidate | TicketOpportunityDurableCandidate
    )[],
  ): Promise<number>;
  failRun(
    runId: string,
    classification: RunFailureClassification,
  ): Promise<void>;
}

export type ShadowRunResult =
  | {
      readonly status: "completed";
      readonly runId: string;
      readonly sourceId: string;
      readonly candidateCount: number;
    }
  | {
      readonly status: "failed";
      readonly runId: string;
      readonly sourceId: string;
      readonly candidateCount: 0;
      readonly failureClassification: RunFailureClassification;
    };

function classifyFailure(error: unknown): RunFailureClassification {
  if (error instanceof SourceFetchFailure) return "source_fetch";
  if (error instanceof SourceParseFailure) return "source_parse";
  if (error instanceof ProviderUnavailableFailure)
    return "provider_unavailable";
  if (
    error instanceof DurableCandidateValidationError ||
    error instanceof OfficialSourceRegistryError
  )
    return "validation";
  return "unexpected";
}

export async function executeOfficialImportShadowRun(
  runId: string,
  source: OfficialSourceDefinition,
  adapter: OfficialSourceAdapter,
  planner: OfficialImportCandidatePlanner,
  repository: OfficialImportStagingRepository,
): Promise<ShadowRunResult> {
  const preparation = await repository.prepareRun(runId, source.id);
  if (preparation.status === "completed") {
    return {
      status: "completed",
      runId,
      sourceId: source.id,
      candidateCount: preparation.candidateCount,
    };
  }
  if (preparation.status === "failed") {
    return {
      status: "failed",
      runId,
      sourceId: source.id,
      candidateCount: 0,
      failureClassification: preparation.failureClassification,
    };
  }

  try {
    const drafts = await adapter.acquire(source);
    const eventCandidates: EventDurableCandidate[] = [];
    const ticketOpportunityCandidates: TicketOpportunityDurableCandidate[] = [];
    for (const draft of drafts) {
      if (draft.candidateKind !== source.domainKind) {
        throw new DurableCandidateValidationError(
          `candidate kind ${draft.candidateKind} does not match source ${source.id}`,
        );
      }
      const canonicalUrl = assertAllowedSourceUrl(source, draft.canonicalUrl);
      if (draft.candidateKind === "event") {
        const proposal = createEventProposal(
          draft.proposal.sourceUrl === null ||
            draft.proposal.sourceUrl === undefined
            ? draft.proposal
            : {
                ...draft.proposal,
                sourceUrl: assertAllowedSourceUrl(
                  source,
                  draft.proposal.sourceUrl,
                ),
              },
        );
        const canonicalDraft = {
          candidateKind: draft.candidateKind,
          canonicalUrl,
          officialExternalId: draft.officialExternalId,
          observedAt: draft.observedAt,
          contentHash: draft.contentHash,
          etag: draft.etag,
          lastModified: draft.lastModified,
          evidenceLocator: createEvidenceLocator(draft.evidenceLocator),
          proposal,
        };
        const planning = await planner.planEvent(source, canonicalDraft);
        const candidate = createEventDurableCandidate({
          runId,
          sourceId: source.id,
          canonicalUrl,
          officialExternalId: draft.officialExternalId,
          observedAt: draft.observedAt,
          contentHash: draft.contentHash,
          etag: draft.etag,
          lastModified: draft.lastModified,
          proposal,
          evidenceLocator: draft.evidenceLocator,
          plan: planning.plan,
          planFingerprint: planning.planFingerprint,
          deterministicMatchStatus: planning.deterministicMatchStatus,
          semanticMatchStatus: planning.semanticMatchStatus,
          resolvedEventId: planning.resolvedEventId,
          resolvedTicketOpportunityId: planning.resolvedTicketOpportunityId,
          jevDecisionEvidence: planning.jevDecisionEvidence,
        });
        eventCandidates.push(candidate);
      } else {
        const proposal = createTicketOpportunityProposal(
          draft.proposal.sourceUrl === null ||
            draft.proposal.sourceUrl === undefined
            ? draft.proposal
            : {
                ...draft.proposal,
                sourceUrl: assertAllowedSourceUrl(
                  source,
                  draft.proposal.sourceUrl,
                ),
              },
        );
        const canonicalDraft = {
          candidateKind: draft.candidateKind,
          canonicalUrl,
          officialExternalId: draft.officialExternalId,
          observedAt: draft.observedAt,
          contentHash: draft.contentHash,
          etag: draft.etag,
          lastModified: draft.lastModified,
          evidenceLocator: createEvidenceLocator(draft.evidenceLocator),
          proposal,
        };
        const planning = await planner.planTicketOpportunity(
          source,
          canonicalDraft,
        );
        const candidate = createTicketOpportunityDurableCandidate({
          runId,
          sourceId: source.id,
          canonicalUrl,
          officialExternalId: draft.officialExternalId,
          observedAt: draft.observedAt,
          contentHash: draft.contentHash,
          etag: draft.etag,
          lastModified: draft.lastModified,
          proposal,
          evidenceLocator: draft.evidenceLocator,
          plan: planning.plan,
          planFingerprint: planning.planFingerprint,
          deterministicMatchStatus: planning.deterministicMatchStatus,
          semanticMatchStatus: planning.semanticMatchStatus,
          resolvedEventId: planning.resolvedEventId,
          resolvedTicketOpportunityId: planning.resolvedTicketOpportunityId,
          jevDecisionEvidence: planning.jevDecisionEvidence,
        });
        ticketOpportunityCandidates.push(candidate);
      }
    }

    // The repository publishes the complete validated typed batch and
    // completes the run in one database transaction. A competing retry gets
    // the already committed count from that same serialization boundary.
    const candidateCount = await repository.commitCandidates(runId, source.id, [
      ...eventCandidates,
      ...ticketOpportunityCandidates,
    ]);
    return {
      status: "completed",
      runId,
      sourceId: source.id,
      candidateCount,
    };
  } catch (error) {
    const failureClassification = classifyFailure(error);
    await repository.failRun(runId, failureClassification);
    return {
      status: "failed",
      runId,
      sourceId: source.id,
      candidateCount: 0,
      failureClassification,
    };
  }
}
