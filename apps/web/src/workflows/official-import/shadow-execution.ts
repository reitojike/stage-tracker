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

export interface OfficialImportStagingRepository {
  createRun(sourceId: string): Promise<string>;
  insertEventCandidate(candidate: EventDurableCandidate): Promise<void>;
  insertTicketOpportunityCandidate(
    candidate: TicketOpportunityDurableCandidate,
  ): Promise<void>;
  completeRun(runId: string): Promise<void>;
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
  source: OfficialSourceDefinition,
  adapter: OfficialSourceAdapter,
  planner: OfficialImportCandidatePlanner,
  repository: OfficialImportStagingRepository,
): Promise<ShadowRunResult> {
  const runId = await repository.createRun(source.id);
  let insertedCount = 0;
  try {
    const drafts = await adapter.acquire(source);
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
        await repository.insertEventCandidate(candidate);
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
        await repository.insertTicketOpportunityCandidate(candidate);
      }
      insertedCount += 1;
    }
    await repository.completeRun(runId);
    return {
      status: "completed",
      runId,
      sourceId: source.id,
      candidateCount: insertedCount,
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
