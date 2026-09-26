import {
  createEventProposal,
  createTicketOpportunityProposal,
  DurableCandidateValidationError,
  parseCanonicalProposal,
  type EventProposalInput,
  type TicketOpportunityProposalInput,
} from "@stage-tracker/official-import/durable-candidate";
import {
  ProviderUnavailableFailure,
  type EventAcquisitionDraft,
  type OfficialImportCandidatePlanner,
  type TicketOpportunityAcquisitionDraft,
} from "./acquisition";
import {
  OfficialSourceRegistryError,
  assertAllowedSourceUrl,
  requireEnabledShadowSource,
} from "./source-registry";

export type CandidateApplyFailureClassification =
  | "validation"
  | "identity_ambiguous"
  | "source_changed"
  | "target_missing"
  | "write_conflict"
  | "provider_unavailable"
  | "policy_blocked"
  | "unexpected";

export type CandidateApplyTransition =
  "applied" | "failed" | "not_owner" | "not_started" | "queued";

export interface OfficialImportApplyCandidate {
  readonly id: string;
  readonly sourceId: string;
  readonly candidateKind: "event" | "ticket_opportunity";
  readonly canonicalUrl: string;
  readonly officialExternalId: string | null;
  readonly observedAt: string;
  readonly contentHash: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly proposalVersion: string;
  readonly proposal: unknown;
  readonly evidenceLocator: unknown;
  readonly planFingerprint: string;
  readonly deterministicMatchStatus:
    "unresolved" | "matched" | "unmatched" | "ambiguous";
  readonly semanticMatchStatus:
    "not_used" | "matched" | "unmatched" | "ambiguous" | "low_confidence";
  readonly resolvedEventId: string | null;
  readonly resolvedTicketOpportunityId: string | null;
  readonly reviewerId: string;
  readonly manualEventBinding?: {
    readonly eventId: string;
    readonly eventSourceKey: string | null;
  } | null;
}

export type CandidateApplyPreparation =
  | {
      readonly status: "ready";
      readonly candidate: OfficialImportApplyCandidate;
    }
  | { readonly status: "busy" }
  | { readonly status: "applied" }
  | { readonly status: "not_approved" };

export interface OfficialImportApplyRepository {
  prepareCandidate(
    candidateId: string,
    attemptToken: string,
  ): Promise<CandidateApplyPreparation>;
  completeCandidate(
    candidateId: string,
    attemptToken: string,
  ): Promise<CandidateApplyTransition>;
  failCandidate(
    candidateId: string,
    attemptToken: string,
    classification: CandidateApplyFailureClassification,
  ): Promise<CandidateApplyTransition>;
}

export interface OfficialImportCatalogApplyPlan {
  readonly action: "create" | "update" | "unchanged";
  readonly hasChanges: boolean;
  readonly resolvedEventId: string | null;
  readonly resolvedTicketOpportunityId: string | null;
  apply(): Promise<void>;
}

export interface OfficialImportCatalogGateway {
  prepareEvent(
    proposal: EventProposalInput,
    reviewerId: string,
    targetEventId: string | null,
  ): Promise<OfficialImportCatalogApplyPlan>;
  prepareTicketOpportunity(
    proposal: TicketOpportunityProposalInput,
    targetEventId?: string | null,
  ): Promise<OfficialImportCatalogApplyPlan>;
}

export const OFFICIAL_IMPORT_APPLY_LEASE_SECONDS = 300;
export const OFFICIAL_IMPORT_APPLY_BUSY_RETRY_AFTER_MS =
  (OFFICIAL_IMPORT_APPLY_LEASE_SECONDS + 5) * 1_000;

export class OfficialImportApplyAttemptRetryError extends Error {
  constructor(
    readonly reason: "busy" | "ownership_lost",
    readonly retryAfterMs?: number,
  ) {
    super("Official import apply attempt must be retried");
    this.name = "OfficialImportApplyAttemptRetryError";
  }
}

export class OfficialImportCatalogFailure extends Error {
  constructor(
    readonly classification: CandidateApplyFailureClassification,
    message = "Official import catalog operation failed",
  ) {
    super(message);
    this.name = "OfficialImportCatalogFailure";
  }
}

export type OfficialImportApplyResult =
  | {
      readonly status: "applied";
      readonly candidateId: string;
      readonly outcome: "written" | "converged" | "already_applied";
    }
  | {
      readonly status: "failed";
      readonly candidateId: string;
      readonly failureClassification: CandidateApplyFailureClassification;
    }
  | { readonly status: "not_approved"; readonly candidateId: string };

function failure(classification: CandidateApplyFailureClassification): never {
  throw new OfficialImportCatalogFailure(classification);
}

function canonicalSourceUrl(
  source: ReturnType<typeof requireEnabledShadowSource>,
  value: string | null,
): string | null {
  return value === null ? null : assertAllowedSourceUrl(source, value);
}

function eventDraft(
  candidate: OfficialImportApplyCandidate,
  proposal: EventProposalInput,
): EventAcquisitionDraft {
  const source = requireEnabledShadowSource(candidate.sourceId);
  return {
    candidateKind: "event",
    canonicalUrl: assertAllowedSourceUrl(source, candidate.canonicalUrl),
    officialExternalId: candidate.officialExternalId,
    observedAt: candidate.observedAt,
    contentHash: candidate.contentHash,
    etag: candidate.etag,
    lastModified: candidate.lastModified,
    proposal:
      proposal.sourceUrl === undefined
        ? proposal
        : {
            ...proposal,
            sourceUrl: canonicalSourceUrl(source, proposal.sourceUrl),
          },
  };
}

function ticketDraft(
  candidate: OfficialImportApplyCandidate,
  proposal: TicketOpportunityProposalInput,
): TicketOpportunityAcquisitionDraft {
  const source = requireEnabledShadowSource(candidate.sourceId);
  return {
    candidateKind: "ticket_opportunity",
    canonicalUrl: assertAllowedSourceUrl(source, candidate.canonicalUrl),
    officialExternalId: candidate.officialExternalId,
    observedAt: candidate.observedAt,
    contentHash: candidate.contentHash,
    etag: candidate.etag,
    lastModified: candidate.lastModified,
    proposal:
      proposal.sourceUrl === undefined
        ? proposal
        : {
            ...proposal,
            sourceUrl: canonicalSourceUrl(source, proposal.sourceUrl),
          },
  };
}

function requireDeterministicEventIdentity(planning: {
  readonly deterministicMatchStatus?: string;
  readonly semanticMatchStatus?: string;
  readonly resolvedEventId?: string | null;
}): void {
  if (planning.semanticMatchStatus !== "not_used") {
    failure("identity_ambiguous");
  }
  if (
    planning.deterministicMatchStatus === "matched" &&
    planning.resolvedEventId !== null &&
    planning.resolvedEventId !== undefined
  ) {
    return;
  }
  if (
    planning.deterministicMatchStatus === "unmatched" &&
    (planning.resolvedEventId === null ||
      planning.resolvedEventId === undefined)
  ) {
    return;
  }
  failure("identity_ambiguous");
}

function requireDeterministicTicketIdentity(planning: {
  readonly deterministicMatchStatus?: string;
  readonly semanticMatchStatus?: string;
  readonly resolvedEventId?: string | null;
}): void {
  if (
    planning.deterministicMatchStatus !== "matched" ||
    planning.semanticMatchStatus !== "not_used" ||
    planning.resolvedEventId === null ||
    planning.resolvedEventId === undefined
  ) {
    failure("identity_ambiguous");
  }
}

function compatibleReviewedIdentity(
  candidate: OfficialImportApplyCandidate,
  freshEventId: string | null,
  freshTicketOpportunityId: string | null,
  converged: boolean,
): boolean {
  const eventCompatible =
    candidate.resolvedEventId === freshEventId ||
    (candidate.candidateKind === "event" &&
      converged &&
      candidate.resolvedEventId === null &&
      freshEventId !== null);
  if (!eventCompatible) return false;
  return (
    candidate.resolvedTicketOpportunityId === freshTicketOpportunityId ||
    (candidate.candidateKind === "ticket_opportunity" &&
      converged &&
      candidate.resolvedTicketOpportunityId === null &&
      freshTicketOpportunityId !== null)
  );
}

function classifyFailure(error: unknown): CandidateApplyFailureClassification {
  if (error instanceof OfficialImportCatalogFailure)
    return error.classification;
  if (error instanceof ProviderUnavailableFailure)
    return "provider_unavailable";
  if (
    error instanceof DurableCandidateValidationError ||
    error instanceof OfficialSourceRegistryError
  )
    return "validation";
  return "unexpected";
}

async function complete(
  repository: OfficialImportApplyRepository,
  candidateId: string,
  attemptToken: string,
): Promise<void> {
  let transition: CandidateApplyTransition;
  try {
    transition = await repository.completeCandidate(candidateId, attemptToken);
  } catch {
    // The catalog RPC already committed. Never turn an uncertain completion
    // record into a terminal candidate failure; retry and converge instead.
    throw new OfficialImportApplyAttemptRetryError("ownership_lost");
  }
  if (transition !== "applied") {
    throw new OfficialImportApplyAttemptRetryError("ownership_lost");
  }
}

export async function executeOfficialImportCandidateApply(
  candidateId: string,
  attemptToken: string,
  planner: OfficialImportCandidatePlanner,
  repository: OfficialImportApplyRepository,
  catalog: OfficialImportCatalogGateway,
): Promise<OfficialImportApplyResult> {
  const preparation = await repository.prepareCandidate(
    candidateId,
    attemptToken,
  );
  if (preparation.status === "busy") {
    throw new OfficialImportApplyAttemptRetryError(
      "busy",
      OFFICIAL_IMPORT_APPLY_BUSY_RETRY_AFTER_MS,
    );
  }
  if (preparation.status === "applied") {
    return { status: "applied", candidateId, outcome: "already_applied" };
  }
  if (preparation.status === "not_approved") {
    return { status: "not_approved", candidateId };
  }

  const { candidate } = preparation;
  const manualBinding =
    candidate.candidateKind === "ticket_opportunity"
      ? (candidate.manualEventBinding ?? null)
      : null;
  const newlyBoundTicket =
    manualBinding !== null && candidate.resolvedEventId === null;
  try {
    const source = requireEnabledShadowSource(candidate.sourceId);
    if (source.domainKind !== candidate.candidateKind)
      failure("policy_blocked");

    const canonical = parseCanonicalProposal(
      candidate.candidateKind,
      candidate.proposalVersion,
      candidate.proposal,
    );

    let freshFingerprint: string;
    let freshEventId: string | null;
    let freshTicketOpportunityId: string | null;
    let catalogPlan: OfficialImportCatalogApplyPlan;

    if (candidate.candidateKind === "event") {
      const proposal = createEventProposal(canonical);
      const planning = await planner.planEvent(
        source,
        eventDraft(candidate, proposal),
      );
      requireDeterministicEventIdentity(planning);
      freshFingerprint = planning.planFingerprint;
      freshEventId = planning.resolvedEventId ?? null;
      freshTicketOpportunityId = null;
      catalogPlan = await catalog.prepareEvent(
        proposal,
        candidate.reviewerId,
        freshEventId,
      );
    } else {
      const proposal = createTicketOpportunityProposal(canonical);
      const planningInput =
        newlyBoundTicket && manualBinding?.eventSourceKey !== null
          ? { ...proposal, eventSourceKey: manualBinding.eventSourceKey }
          : proposal;
      const planning = await planner.planTicketOpportunity(
        source,
        ticketDraft(candidate, planningInput),
      );
      requireDeterministicTicketIdentity(planning);
      if (
        manualBinding !== null &&
        (planning.resolvedEventId !== manualBinding.eventId ||
          (newlyBoundTicket && planning.plan.eventChanged))
      )
        failure("identity_ambiguous");
      freshFingerprint = planning.planFingerprint;
      freshEventId = planning.resolvedEventId ?? null;
      freshTicketOpportunityId = planning.resolvedTicketOpportunityId ?? null;
      catalogPlan = await catalog.prepareTicketOpportunity(
        manualBinding === null
          ? proposal
          : createTicketOpportunityProposal(planning.proposal ?? planningInput),
        manualBinding?.eventId ?? null,
      );
    }

    if (
      catalogPlan.resolvedEventId !== freshEventId ||
      catalogPlan.resolvedTicketOpportunityId !== freshTicketOpportunityId
    ) {
      failure("identity_ambiguous");
    }

    const converged = !catalogPlan.hasChanges;
    // The unresolved candidate did not show a reviewed diff against an
    // existing TicketOpportunity. A manual Event decision may create a new
    // opportunity, but must never silently apply an existing target's update.
    if (newlyBoundTicket && freshTicketOpportunityId !== null && !converged)
      failure("source_changed");
    if (
      !newlyBoundTicket &&
      !compatibleReviewedIdentity(
        candidate,
        freshEventId,
        freshTicketOpportunityId,
        converged,
      )
    )
      failure("source_changed");
    if (manualBinding !== null && freshEventId !== manualBinding.eventId) {
      failure("source_changed");
    }

    if (!newlyBoundTicket && freshFingerprint !== candidate.planFingerprint) {
      if (!converged) failure("source_changed");
      await catalogPlan.apply();
      await complete(repository, candidateId, attemptToken);
      return { status: "applied", candidateId, outcome: "converged" };
    }

    await catalogPlan.apply();
    await complete(repository, candidateId, attemptToken);
    return {
      status: "applied",
      candidateId,
      outcome: catalogPlan.hasChanges ? "written" : "converged",
    };
  } catch (error) {
    if (error instanceof OfficialImportApplyAttemptRetryError) throw error;
    const failureClassification = classifyFailure(error);
    const transition = await repository.failCandidate(
      candidateId,
      attemptToken,
      failureClassification,
    );
    if (transition === "failed") {
      return {
        status: "failed",
        candidateId,
        failureClassification,
      };
    }
    if (transition === "applied") {
      return { status: "applied", candidateId, outcome: "already_applied" };
    }
    throw new OfficialImportApplyAttemptRetryError("ownership_lost");
  }
}
