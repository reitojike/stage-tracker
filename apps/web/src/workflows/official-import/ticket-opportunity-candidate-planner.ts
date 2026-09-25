import { createHash } from "node:crypto";
import type { TicketOpportunityProposalInput } from "@stage-tracker/official-import/durable-candidate";
import type {
  EventAcquisitionDraft,
  OfficialImportCandidatePlanner,
  TicketOpportunityAcquisitionDraft,
  TicketOpportunityPlanningResult,
} from "./acquisition";
import type {
  CatalogEventMatch,
  EventMatchRepository,
  EventSemanticAligner,
} from "./event-candidate-planner";

export interface CatalogTicketOpportunityMatch {
  readonly id: string;
  readonly eventId: string;
  readonly displayName: string;
  readonly targetScope: string;
  readonly sourceUrl: string | null;
  readonly memo: string | null;
  readonly targetOccurrences: readonly string[];
  readonly milestones: readonly {
    readonly type: string;
    readonly precision: string;
    readonly date: string | null;
    readonly at: string | null;
    readonly startsAt: string | null;
    readonly endsAt: string | null;
  }[];
}

export interface TicketOpportunityMatchRepository {
  findExactBySourceKey(
    sourceKey: string,
  ): Promise<CatalogTicketOpportunityMatch | null>;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, "");
}

function normalizeVenue(value: string | null | undefined): string {
  return normalize(value)
    .replace(/^劇場/u, "")
    .replace(/^京都四條南座/u, "南座");
}

function sameInstant(left: string, right: string): boolean {
  return Date.parse(left) === Date.parse(right);
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value) => right.some((other) => sameInstant(value, other)))
  );
}

function canonicalMilestone(
  milestone: NonNullable<TicketOpportunityProposalInput["milestones"]>[number],
) {
  if (milestone.precision === "date") {
    return {
      type: milestone.type,
      precision: milestone.precision,
      date: milestone.date,
      at: null,
      startsAt: null,
      endsAt: null,
    };
  }
  if (milestone.precision === "datetime") {
    return {
      type: milestone.type,
      precision: milestone.precision,
      date: null,
      at: milestone.at,
      startsAt: null,
      endsAt: null,
    };
  }
  return {
    type: milestone.type,
    precision: milestone.precision,
    date: null,
    at: null,
    startsAt: milestone.startsAt,
    endsAt: milestone.endsAt,
  };
}

function milestonesEqual(
  proposal: TicketOpportunityProposalInput,
  current: CatalogTicketOpportunityMatch,
): boolean {
  const proposed = (proposal.milestones ?? []).map(canonicalMilestone);
  if (proposed.length !== current.milestones.length) return false;
  return proposed.every((milestone) => {
    const other = current.milestones.find(
      (candidate) => candidate.type === milestone.type,
    );
    return (
      other !== undefined &&
      other.precision === milestone.precision &&
      other.date === milestone.date &&
      (other.at === milestone.at ||
        (other.at !== null &&
          milestone.at !== null &&
          sameInstant(other.at, milestone.at))) &&
      (other.startsAt === milestone.startsAt ||
        (other.startsAt !== null &&
          milestone.startsAt !== null &&
          sameInstant(other.startsAt, milestone.startsAt))) &&
      (other.endsAt === milestone.endsAt ||
        (other.endsAt !== null &&
          milestone.endsAt !== null &&
          sameInstant(other.endsAt, milestone.endsAt)))
    );
  });
}

function planFor(
  proposal: TicketOpportunityProposalInput,
  event: CatalogEventMatch | null,
  current: CatalogTicketOpportunityMatch | null,
) {
  const occurrenceIds = proposal.targetOccurrences ?? [];
  const milestones = proposal.milestones ?? [];
  if (current === null) {
    return {
      action: "create" as const,
      eventChanged: false,
      detailsChanged: false,
      occurrencesChanged: false,
      milestonesChanged: false,
      occurrenceIds,
      milestones,
    };
  }
  const eventChanged = event !== null && current.eventId !== event.id;
  const detailsChanged =
    current.displayName !== proposal.displayName ||
    current.targetScope !== proposal.targetScope ||
    current.sourceUrl !== (proposal.sourceUrl ?? null) ||
    current.memo !== (proposal.memo ?? null);
  const occurrencesChanged = !sameStringSet(
    current.targetOccurrences,
    occurrenceIds,
  );
  const milestonesChanged = !milestonesEqual(proposal, current);
  return {
    action:
      eventChanged || detailsChanged || occurrencesChanged || milestonesChanged
        ? ("update" as const)
        : ("unchanged" as const),
    eventChanged,
    detailsChanged,
    occurrencesChanged,
    milestonesChanged,
    occurrenceIds,
    milestones,
  };
}

function originOf(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function retainExistingGeneralSale(
  proposal: TicketOpportunityProposalInput,
  current: CatalogTicketOpportunityMatch | null,
  eventId: string,
): boolean {
  if (
    current === null ||
    current.eventId !== eventId ||
    !proposal.sourceKey.startsWith("shochiku:kabuki-bito:") ||
    !proposal.sourceKey.endsWith(":general")
  )
    return false;
  const proposedOrigin = originOf(proposal.sourceUrl);
  const currentOrigin = originOf(current.sourceUrl);
  if (
    proposedOrigin === "https://www.kabuki-bito.jp" &&
    currentOrigin === "https://www1.ticket-web-shochiku.com"
  )
    return true;
  const proposed = proposal.milestones?.[0];
  const existing = current.milestones[0];
  return (
    proposedOrigin === "https://www1.ticket-web-shochiku.com" &&
    currentOrigin === "https://www.kabuki-bito.jp" &&
    proposed?.precision === "date" &&
    existing?.type === "sale_start" &&
    existing.precision === "datetime" &&
    existing.at?.slice(0, 10) === proposed.date
  );
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function eventDraft(
  draft: TicketOpportunityAcquisitionDraft,
): EventAcquisitionDraft | null {
  const reference = draft.eventReference;
  if (reference === undefined) return null;
  return {
    candidateKind: "event",
    canonicalUrl: draft.canonicalUrl,
    observedAt: draft.observedAt,
    contentHash: draft.contentHash,
    proposal: {
      sourceKey: draft.proposal.eventSourceKey,
      title: reference.title,
      venue: reference.venue ?? null,
      startsOn: reference.startsOn,
      endsOn: reference.endsOn,
      occurrences: [],
    },
  };
}

function deterministicEvent(
  draft: EventAcquisitionDraft,
  candidates: readonly CatalogEventMatch[],
): CatalogEventMatch | null {
  const matches = candidates.filter(
    (candidate) =>
      candidate.sourceKey !== null &&
      normalize(candidate.title) === normalize(draft.proposal.title) &&
      normalizeVenue(candidate.venue) !== "" &&
      normalizeVenue(candidate.venue) ===
        normalizeVenue(draft.proposal.venue) &&
      candidate.startsOn === draft.proposal.startsOn &&
      candidate.endsOn === draft.proposal.endsOn,
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function result(
  proposal: TicketOpportunityProposalInput,
  planning: Omit<TicketOpportunityPlanningResult, "planFingerprint">,
  current: {
    readonly event: CatalogEventMatch | null;
    readonly opportunity: CatalogTicketOpportunityMatch | null;
  },
): TicketOpportunityPlanningResult {
  return {
    ...planning,
    proposal,
    planFingerprint: fingerprint({ proposal, ...planning, current }),
  };
}

export function createTicketOpportunityCandidatePlanner(
  events: EventMatchRepository,
  opportunities: TicketOpportunityMatchRepository,
  aligner: EventSemanticAligner,
): Pick<OfficialImportCandidatePlanner, "planTicketOpportunity"> {
  return {
    async planTicketOpportunity(_source, draft) {
      let matchedEvent = await events.findExactBySourceKey(
        draft.proposal.eventSourceKey,
      );
      let deterministicMatchStatus: "matched" | "unresolved" | "ambiguous" =
        matchedEvent === null ? "unresolved" : "matched";
      let semanticMatchStatus:
        "not_used" | "matched" | "unmatched" | "ambiguous" | "low_confidence" =
        "not_used";
      let jevDecisionEvidence = null;
      const reference = eventDraft(draft);

      if (matchedEvent === null && reference !== null) {
        const sameTitleAndVenue = (
          candidate: Pick<CatalogEventMatch, "title" | "venue">,
        ) =>
          normalize(candidate.title) === normalize(reference.proposal.title) &&
          normalizeVenue(candidate.venue) ===
            normalizeVenue(reference.proposal.venue);
        const candidates = await events.findPotentialMatches(
          reference.proposal.startsOn,
          reference.proposal.endsOn,
          sameTitleAndVenue,
        );
        const plausible = candidates.filter(sameTitleAndVenue);
        const includesManualIdentity = plausible.some(
          (candidate) => candidate.sourceKey === null,
        );
        matchedEvent = includesManualIdentity
          ? null
          : deterministicEvent(reference, plausible);
        if (matchedEvent !== null) {
          deterministicMatchStatus = "matched";
        } else if (plausible.length === 0) {
          semanticMatchStatus = "low_confidence";
        } else {
          const alignment = await aligner.align(reference, plausible);
          if (alignment.status !== "unavailable") {
            jevDecisionEvidence = alignment.evidence;
          }
          if (includesManualIdentity) {
            deterministicMatchStatus = "ambiguous";
            semanticMatchStatus =
              alignment.status === "unavailable"
                ? "low_confidence"
                : alignment.status;
          } else if (alignment.status === "matched") {
            const aligned = plausible.find(
              (candidate) => candidate.id === alignment.eventId,
            );
            if (
              aligned !== undefined &&
              aligned.sourceKey !== null &&
              alignment.confidence >= 0.85
            ) {
              matchedEvent = aligned;
              semanticMatchStatus = "matched";
            } else {
              semanticMatchStatus = "low_confidence";
            }
          } else {
            semanticMatchStatus =
              alignment.status === "unavailable"
                ? "low_confidence"
                : alignment.status;
          }
        }
      }

      if (matchedEvent === null || matchedEvent.sourceKey === null) {
        const plan = planFor(draft.proposal, null, null);
        return result(
          draft.proposal,
          {
            plan,
            deterministicMatchStatus,
            // A Ticket Opportunity cannot be apply-capable without a resolved
            // Event. Even a confident semantic `no_match` therefore remains a
            // review block instead of becoming an ordinary pending candidate.
            semanticMatchStatus:
              semanticMatchStatus === "ambiguous"
                ? "ambiguous"
                : "low_confidence",
            resolvedEventId: null,
            resolvedTicketOpportunityId: null,
            jevDecisionEvidence,
          },
          { event: null, opportunity: null },
        );
      }

      const generalSale =
        _source.id === "ticket.shochiku.schedule" &&
        /^(?:一般販売|一般発売)$/u.test(draft.proposal.displayName) &&
        matchedEvent.sourceKey.startsWith("kabuki-bito:");
      const proposal = {
        ...draft.proposal,
        eventSourceKey: matchedEvent.sourceKey,
        ...(generalSale
          ? {
              sourceKey: `shochiku:${matchedEvent.sourceKey}:general`,
            }
          : {}),
      };
      const current = await opportunities.findExactBySourceKey(
        proposal.sourceKey,
      );
      const planned = planFor(proposal, matchedEvent, current);
      const plan = retainExistingGeneralSale(proposal, current, matchedEvent.id)
        ? {
            ...planned,
            action: "unchanged" as const,
            eventChanged: false,
            detailsChanged: false,
            occurrencesChanged: false,
            milestonesChanged: false,
          }
        : planned;
      return result(
        proposal,
        {
          plan,
          deterministicMatchStatus,
          semanticMatchStatus,
          resolvedEventId: matchedEvent.id,
          resolvedTicketOpportunityId: current?.id ?? null,
          jevDecisionEvidence,
        },
        { event: matchedEvent, opportunity: current },
      );
    },
  };
}
