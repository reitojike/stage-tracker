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
import { tokyoCalendarDateSchema } from "@stage-tracker/domain";
import {
  ProviderUnavailableFailure,
  SourceFetchFailure,
  SourceParseFailure,
  type OfficialImportCandidatePlanner,
  type OfficialSourceAdapter,
  type HeldSourcePage,
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
  | { readonly status: "busy" }
  | { readonly status: "completed"; readonly candidateCount: number }
  | {
      readonly status: "failed";
      readonly failureClassification: RunFailureClassification;
    };

export const OFFICIAL_IMPORT_ATTEMPT_LEASE_SECONDS = 300;
export const OFFICIAL_IMPORT_BUSY_RETRY_AFTER_MS =
  (OFFICIAL_IMPORT_ATTEMPT_LEASE_SECONDS + 5) * 1_000;
const OFFICIAL_IMPORT_LEASE_HEARTBEAT_MS = 60_000;

export type OfficialImportRetryReason =
  "busy" | "source_fetch" | "provider_unavailable" | "ownership_lost";

export class OfficialImportAttemptRetryError extends Error {
  constructor(
    readonly reason: OfficialImportRetryReason,
    readonly retryAfterMs?: number,
  ) {
    super("Official import attempt must be retried");
    this.name = "OfficialImportAttemptRetryError";
  }
}

export type RunAttemptTransition =
  "released" | "not_owner" | "completed" | "failed";

export interface OfficialImportStagingRepository {
  prepareRun(
    runId: string,
    sourceId: string,
    attemptToken: string,
  ): Promise<RunPreparation>;
  commitCandidates(
    runId: string,
    sourceId: string,
    attemptToken: string,
    candidates: readonly (
      EventDurableCandidate | TicketOpportunityDurableCandidate
    )[],
    heldPages?: readonly HeldSourcePage[],
  ): Promise<number>;
  releaseRun(
    runId: string,
    sourceId: string,
    attemptToken: string,
  ): Promise<RunAttemptTransition>;
  failRun(
    runId: string,
    sourceId: string,
    attemptToken: string,
    classification: RunFailureClassification,
  ): Promise<RunAttemptTransition>;
}

function startAttemptLeaseHeartbeat(
  repository: OfficialImportStagingRepository,
  runId: string,
  sourceId: string,
  attemptToken: string,
  intervalMs: number,
) {
  let stopped = false;
  let renewal: Promise<void> | null = null;
  let ownershipUncertain = false;
  const markOwnershipUncertain = () => {
    ownershipUncertain = true;
    stopped = true;
    clearInterval(timer);
  };
  const timer = setInterval(() => {
    if (stopped || renewal !== null) return;
    // Reclaiming with the same owner token refreshes the current lease under
    // the database run/source locks. Stop and drain before any terminal RPC.
    renewal = repository
      .prepareRun(runId, sourceId, attemptToken)
      .then((result) => {
        if (result.status !== "ready") markOwnershipUncertain();
      })
      .catch(() => {
        markOwnershipUncertain();
      })
      .finally(() => {
        renewal = null;
      });
  }, intervalMs);
  timer.unref?.();
  return {
    assertOwned() {
      if (ownershipUncertain)
        throw new OfficialImportAttemptRetryError("ownership_lost");
    },
    async stopAndDrain() {
      stopped = true;
      clearInterval(timer);
      const inFlight = renewal;
      if (inFlight !== null) await inFlight;
    },
  };
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

function isTransientFailure(
  classification: RunFailureClassification,
): classification is "source_fetch" | "provider_unavailable" {
  return (
    classification === "source_fetch" ||
    classification === "provider_unavailable"
  );
}

export async function executeOfficialImportShadowRun(
  runId: string,
  attemptToken: string,
  source: OfficialSourceDefinition,
  adapter: OfficialSourceAdapter,
  planner: OfficialImportCandidatePlanner,
  repository: OfficialImportStagingRepository,
  leaseHeartbeatIntervalMs = OFFICIAL_IMPORT_LEASE_HEARTBEAT_MS,
): Promise<ShadowRunResult> {
  const preparation = await repository.prepareRun(
    runId,
    source.id,
    attemptToken,
  );
  if (preparation.status === "busy") {
    throw new OfficialImportAttemptRetryError(
      "busy",
      OFFICIAL_IMPORT_BUSY_RETRY_AFTER_MS,
    );
  }
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

  const lease = startAttemptLeaseHeartbeat(
    repository,
    runId,
    source.id,
    attemptToken,
    leaseHeartbeatIntervalMs,
  );
  try {
    const heldPages: HeldSourcePage[] = [];
    const heldUrls = new Set<string>();
    const recordHeldPage = (page: HeldSourcePage) => {
      const canonicalUrl = assertAllowedSourceUrl(source, page.canonicalUrl);
      if (
        heldPages.length >= 30 ||
        heldUrls.has(canonicalUrl) ||
        (page.reasonCode !== "source_parse" &&
          page.reasonCode !== "published_end_missing") ||
        page.officialExternalId.length < 1 ||
        page.officialExternalId.length > 512 ||
        page.officialExternalId.trim() !== page.officialExternalId ||
        page.title.length < 1 ||
        page.title.length > 512 ||
        page.title.trim() !== page.title ||
        !tokyoCalendarDateSchema.safeParse(page.startsOn).success ||
        !tokyoCalendarDateSchema.safeParse(page.endsOn).success ||
        page.startsOn > page.endsOn
      )
        throw new DurableCandidateValidationError(
          "Invalid held official source page",
        );
      heldUrls.add(canonicalUrl);
      heldPages.push({ ...page, canonicalUrl });
    };
    const drafts = await adapter.acquire(source, recordHeldPage);
    lease.assertOwned();
    const eventCandidates: EventDurableCandidate[] = [];
    const ticketOpportunityCandidates: TicketOpportunityDurableCandidate[] = [];
    for (const draft of drafts) {
      lease.assertOwned();
      if (draft.candidateKind !== source.domainKind) {
        throw new DurableCandidateValidationError(
          `candidate kind ${draft.candidateKind} does not match source ${source.id}`,
        );
      }
      const canonicalUrl = assertAllowedSourceUrl(source, draft.canonicalUrl);
      if (heldUrls.has(canonicalUrl))
        throw new DurableCandidateValidationError(
          "Official page cannot be both held and a candidate",
        );
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
        if (planning.holdReason === "published_end_missing") {
          recordHeldPage({
            canonicalUrl,
            officialExternalId: draft.officialExternalId ?? "",
            title: proposal.title,
            startsOn: proposal.startsOn,
            endsOn: proposal.endsOn,
            reasonCode: "published_end_missing",
          });
          continue;
        }
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
          ...(draft.eventReference === undefined
            ? {}
            : { eventReference: draft.eventReference }),
        };
        const planning = await planner.planTicketOpportunity(
          source,
          canonicalDraft,
        );
        const plannedProposal = createTicketOpportunityProposal(
          planning.proposal ?? proposal,
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
          proposal: plannedProposal,
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
    await lease.stopAndDrain();
    lease.assertOwned();
    const candidates = [...eventCandidates, ...ticketOpportunityCandidates];
    const candidateCount =
      heldPages.length === 0
        ? await repository.commitCandidates(
            runId,
            source.id,
            attemptToken,
            candidates,
          )
        : await repository.commitCandidates(
            runId,
            source.id,
            attemptToken,
            candidates,
            heldPages,
          );
    return {
      status: "completed",
      runId,
      sourceId: source.id,
      candidateCount,
    };
  } catch (error) {
    // A pending renewal may otherwise reclaim the lease after releaseRun or
    // failRun clears it, delaying the next Workflow attempt by a full lease.
    await lease.stopAndDrain();
    try {
      lease.assertOwned();
    } catch (ownershipError) {
      // The token-guarded release is safe even if another attempt has taken
      // over. Do not leave a still-owned lease alive after a failed renewal.
      await repository.releaseRun(runId, source.id, attemptToken);
      throw ownershipError;
    }
    if (error instanceof OfficialImportAttemptRetryError) throw error;
    const failureClassification = classifyFailure(error);
    if (isTransientFailure(failureClassification)) {
      await repository.releaseRun(runId, source.id, attemptToken);
      throw new OfficialImportAttemptRetryError(failureClassification);
    }

    const transition = await repository.failRun(
      runId,
      source.id,
      attemptToken,
      failureClassification,
    );
    if (transition === "failed") {
      const terminal = await repository.prepareRun(
        runId,
        source.id,
        attemptToken,
      );
      if (terminal.status === "failed") {
        return {
          status: "failed",
          runId,
          sourceId: source.id,
          candidateCount: 0,
          failureClassification: terminal.failureClassification,
        };
      }
    }
    throw new OfficialImportAttemptRetryError("ownership_lost");
  } finally {
    await lease.stopAndDrain();
  }
}
