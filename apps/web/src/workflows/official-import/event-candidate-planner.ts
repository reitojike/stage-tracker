import { createHash } from "node:crypto";
import type {
  EventPlanInput,
  JevDecisionEvidenceInput,
} from "@stage-tracker/official-import/durable-candidate";
import type {
  EventAcquisitionDraft,
  EventPlanningResult,
  OfficialImportCandidatePlanner,
} from "./acquisition";
import type { OfficialSourceDefinition } from "./source-registry";

export interface CatalogEventMatch {
  readonly id: string;
  readonly sourceKey: string | null;
  readonly title: string;
  readonly venue: string | null;
  readonly sourceUrl: string | null;
  readonly memo: string | null;
  readonly genreId: string | null;
  readonly genreKey: string | null;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly occurrences: readonly {
    readonly startsAt: string;
    readonly doorsAt: string | null;
    readonly endsAt: string | null;
  }[];
  readonly groups: readonly {
    readonly key: string;
    readonly displayName: string;
  }[];
}

export interface EventMatchRepository {
  findExactBySourceKey(sourceKey: string): Promise<CatalogEventMatch | null>;
  findPotentialMatches(
    startsOn: string,
    endsOn: string,
  ): Promise<readonly CatalogEventMatch[]>;
}

export type EventAlignmentResult =
  | {
      readonly status: "matched";
      readonly eventId: string;
      readonly confidence: number;
      readonly evidence: JevDecisionEvidenceInput;
    }
  | {
      readonly status: "unmatched" | "ambiguous" | "low_confidence";
      readonly evidence: JevDecisionEvidenceInput;
    }
  | { readonly status: "unavailable" };

export interface EventSemanticAligner {
  align(
    draft: EventAcquisitionDraft,
    candidates: readonly CatalogEventMatch[],
  ): Promise<EventAlignmentResult>;
}

function normalize(value: string | null): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, "");
}

function isDraft(
  value: EventAcquisitionDraft | CatalogEventMatch,
): value is EventAcquisitionDraft {
  return "proposal" in value;
}

function instants(
  value: EventAcquisitionDraft | CatalogEventMatch,
): Set<number> {
  if (isDraft(value)) {
    return new Set(
      value.proposal.occurrences.map((occurrence) =>
        Date.parse(occurrence.startsAt),
      ),
    );
  }
  return new Set(
    value.occurrences.map((occurrence) => Date.parse(occurrence.startsAt)),
  );
}

function hasSharedInstant(
  draft: EventAcquisitionDraft,
  candidate: CatalogEventMatch,
): boolean {
  const existing = instants(candidate);
  return [...instants(draft)].some((instant) => existing.has(instant));
}

function isPlausible(
  draft: EventAcquisitionDraft,
  candidate: CatalogEventMatch,
): boolean {
  const sameVenue =
    normalize(draft.proposal.venue ?? null) !== "" &&
    normalize(draft.proposal.venue ?? null) === normalize(candidate.venue);
  const sameTitle =
    normalize(draft.proposal.title) === normalize(candidate.title);
  const overlappingRange =
    draft.proposal.startsOn <= candidate.endsOn &&
    draft.proposal.endsOn >= candidate.startsOn;
  return (
    overlappingRange &&
    ((sameVenue && hasSharedInstant(draft, candidate)) ||
      (sameVenue && sameTitle) ||
      (sameTitle && hasSharedInstant(draft, candidate)))
  );
}

function deterministicCrossSourceMatch(
  draft: EventAcquisitionDraft,
  candidates: readonly CatalogEventMatch[],
): CatalogEventMatch | null {
  const matches = candidates.filter(
    (candidate) =>
      candidate.sourceKey !== null &&
      normalize(draft.proposal.venue ?? null) !== "" &&
      normalize(draft.proposal.venue ?? null) === normalize(candidate.venue) &&
      hasSharedInstant(draft, candidate),
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function planFor(
  draft: EventAcquisitionDraft,
  current: CatalogEventMatch | null,
): EventPlanInput {
  if (current === null) {
    return {
      action: "create",
      detailsChanged: false,
      rangeChanged: false,
      newOccurrences: draft.proposal.occurrences,
      keptOccurrences: 0,
      genrePlan: { changed: draft.proposal.genre !== undefined },
      groupsPlan: { changed: draft.proposal.groups !== undefined },
    };
  }
  const currentInstants = instants(current);
  const newOccurrences = draft.proposal.occurrences.filter(
    (occurrence) => !currentInstants.has(Date.parse(occurrence.startsAt)),
  );
  const currentByInstant = new Map(
    current.occurrences.map((occurrence) => [
      Date.parse(occurrence.startsAt),
      occurrence,
    ]),
  );
  const endsAtFixes = draft.proposal.occurrences.flatMap((occurrence) => {
    const existing = currentByInstant.get(Date.parse(occurrence.startsAt));
    if (
      existing === undefined ||
      occurrence.endsAt === null ||
      occurrence.endsAt === undefined ||
      (existing.endsAt !== null &&
        Date.parse(existing.endsAt) === Date.parse(occurrence.endsAt))
    ) {
      return [];
    }
    return [
      {
        startsAt: occurrence.startsAt,
        from: existing.endsAt,
        endsAt: occurrence.endsAt,
      },
    ];
  });
  const doorsAtFixes = draft.proposal.occurrences.flatMap((occurrence) => {
    const existing = currentByInstant.get(Date.parse(occurrence.startsAt));
    if (
      existing === undefined ||
      occurrence.doorsAt === null ||
      occurrence.doorsAt === undefined ||
      (existing.doorsAt !== null &&
        Date.parse(existing.doorsAt) === Date.parse(occurrence.doorsAt))
    ) {
      return [];
    }
    return [
      {
        startsAt: occurrence.startsAt,
        from: existing.doorsAt,
        doorsAt: occurrence.doorsAt,
      },
    ];
  });
  const proposedInstants = instants(draft);
  const keptOccurrences = current.occurrences.filter(
    (occurrence) => !proposedInstants.has(Date.parse(occurrence.startsAt)),
  ).length;
  const detailsChanged =
    current.title !== draft.proposal.title ||
    current.venue !== (draft.proposal.venue ?? null) ||
    current.sourceUrl !== (draft.proposal.sourceUrl ?? null) ||
    current.memo !== (draft.proposal.memo ?? null);
  const rangeChanged =
    current.startsOn !== draft.proposal.startsOn ||
    current.endsOn !== draft.proposal.endsOn;
  const genreChanged =
    draft.proposal.genre === undefined
      ? false
      : draft.proposal.genre !== current.genreKey;
  const groupsChanged =
    draft.proposal.groups === undefined
      ? false
      : draft.proposal.groups.length !== current.groups.length ||
        draft.proposal.groups.some((group) =>
          current.groups.every(
            (existing) =>
              existing.key !== group.key ||
              existing.displayName !== group.displayName,
          ),
        );
  return {
    action:
      detailsChanged ||
      rangeChanged ||
      newOccurrences.length > 0 ||
      endsAtFixes.length > 0 ||
      doorsAtFixes.length > 0
        ? "update"
        : "unchanged",
    detailsChanged,
    rangeChanged,
    newOccurrences,
    endsAtFixes,
    doorsAtFixes,
    keptOccurrences,
    genrePlan: { changed: genreChanged },
    groupsPlan: { changed: groupsChanged },
  };
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function result(
  source: OfficialSourceDefinition,
  draft: EventAcquisitionDraft,
  plan: EventPlanInput,
  match: Omit<EventPlanningResult, "plan" | "planFingerprint">,
  current: CatalogEventMatch | null,
): EventPlanningResult {
  const currentByInstant = new Map(
    current?.occurrences.map((occurrence) => [
      Date.parse(occurrence.startsAt),
      occurrence,
    ]) ?? [],
  );
  const publishedEndMissing =
    source.id === "event.kabuki-bito.schedule" &&
    current?.sourceKey === draft.proposal.sourceKey &&
    draft.proposal.occurrences.some((occurrence) => {
      const existing = currentByInstant.get(Date.parse(occurrence.startsAt));
      return (
        existing?.endsAt !== null &&
        existing?.endsAt !== undefined &&
        (occurrence.endsAt === null || occurrence.endsAt === undefined)
      );
    });
  return {
    ...match,
    plan,
    ...(publishedEndMissing
      ? { holdReason: "published_end_missing" as const }
      : {}),
    planFingerprint: fingerprint({
      proposal: draft.proposal,
      plan,
      match,
      current,
    }),
  };
}

export function createEventCandidatePlanner(
  repository: EventMatchRepository,
  aligner: EventSemanticAligner,
): Pick<OfficialImportCandidatePlanner, "planEvent"> {
  return {
    async planEvent(
      source: OfficialSourceDefinition,
      draft: EventAcquisitionDraft,
    ) {
      const exact = await repository.findExactBySourceKey(
        draft.proposal.sourceKey,
      );
      if (exact !== null) {
        return result(
          source,
          draft,
          planFor(draft, exact),
          {
            deterministicMatchStatus: "matched",
            semanticMatchStatus: "not_used",
            resolvedEventId: exact.id,
          },
          exact,
        );
      }

      const candidates = await repository.findPotentialMatches(
        draft.proposal.startsOn,
        draft.proposal.endsOn,
      );
      const plausible = candidates.filter((candidate) =>
        isPlausible(draft, candidate),
      );
      if (plausible.length === 0) {
        return result(
          source,
          draft,
          planFor(draft, null),
          {
            deterministicMatchStatus: "unmatched",
            semanticMatchStatus: "not_used",
            resolvedEventId: null,
          },
          null,
        );
      }

      const manualPossibleDuplicate = plausible.some(
        (candidate) => candidate.sourceKey === null,
      );
      const deterministic = deterministicCrossSourceMatch(draft, plausible);
      if (!manualPossibleDuplicate && deterministic !== null) {
        return result(
          source,
          draft,
          planFor(draft, deterministic),
          {
            deterministicMatchStatus: "matched",
            semanticMatchStatus: "not_used",
            resolvedEventId: deterministic.id,
          },
          deterministic,
        );
      }

      const alignment = await aligner.align(draft, plausible);
      if (manualPossibleDuplicate) {
        return result(
          source,
          draft,
          planFor(draft, null),
          {
            deterministicMatchStatus: "ambiguous",
            semanticMatchStatus:
              alignment.status === "unavailable"
                ? "low_confidence"
                : alignment.status,
            resolvedEventId: null,
            jevDecisionEvidence:
              alignment.status === "unavailable" ? null : alignment.evidence,
          },
          null,
        );
      }
      if (alignment.status === "matched") {
        const matched = plausible.find(
          (candidate) => candidate.id === alignment.eventId,
        );
        if (matched !== undefined && alignment.confidence >= 0.85) {
          return result(
            source,
            draft,
            planFor(draft, matched),
            {
              deterministicMatchStatus: "unresolved",
              semanticMatchStatus: "matched",
              resolvedEventId: matched.id,
              jevDecisionEvidence: alignment.evidence,
            },
            matched,
          );
        }
      }
      if (alignment.status === "unmatched") {
        return result(
          source,
          draft,
          planFor(draft, null),
          {
            deterministicMatchStatus: "unresolved",
            semanticMatchStatus: "unmatched",
            resolvedEventId: null,
            jevDecisionEvidence: alignment.evidence,
          },
          null,
        );
      }
      return result(
        source,
        draft,
        planFor(draft, null),
        {
          deterministicMatchStatus: "unresolved",
          semanticMatchStatus:
            alignment.status === "ambiguous" ? "ambiguous" : "low_confidence",
          resolvedEventId: null,
          jevDecisionEvidence:
            alignment.status === "unavailable" ? null : alignment.evidence,
        },
        null,
      );
    },
  };
}
