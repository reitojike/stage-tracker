import { describe, expect, it, vi } from "vitest";
import type { EventAcquisitionDraft } from "./acquisition";
import { deriveOfficialImportCandidateReviewStatus } from "./candidate-review";
import {
  createEventCandidatePlanner,
  type CatalogEventMatch,
  type EventAlignmentResult,
} from "./event-candidate-planner";
import { getOfficialSource } from "./source-registry";

const source = getOfficialSource("event.cynhn.calendar");
if (source === null) throw new Error("test source missing");

function draft(
  overrides: Partial<EventAcquisitionDraft["proposal"]> = {},
): EventAcquisitionDraft {
  return {
    candidateKind: "event",
    canonicalUrl: "https://cynhn.com/contents/123",
    officialExternalId: "123",
    observedAt: "2026-09-22T00:00:00.000Z",
    contentHash: "a".repeat(64),
    proposal: {
      sourceKey: "skiyaki:cynhn.com:123",
      title: "Group A presents SPECIAL LIVE",
      venue: "Spotify O-WEST",
      sourceUrl: "https://cynhn.com/contents/123",
      startsOn: "2026-10-10",
      endsOn: "2026-10-10",
      occurrences: [{ startsAt: "2026-10-10T18:00:00+09:00" }],
      ...overrides,
    },
  };
}

function event(overrides: Partial<CatalogEventMatch> = {}): CatalogEventMatch {
  return {
    id: "event-1",
    sourceKey: "skiyaki:group-b.example:987",
    title: "Group B 10th Anniversary",
    venue: "Spotify O-WEST",
    startsOn: "2026-10-10",
    endsOn: "2026-10-10",
    occurrences: [
      { startsAt: "2026-10-10T18:00:00+09:00", doorsAt: null, endsAt: null },
    ],
    groups: [{ key: "group-b", displayName: "Group B" }],
    ...overrides,
  };
}

function setup(
  exact: CatalogEventMatch | null,
  potential: readonly CatalogEventMatch[],
  alignment: EventAlignmentResult = { status: "unavailable" },
) {
  const align = vi.fn(async () => alignment);
  const planner = createEventCandidatePlanner(
    {
      findExactBySourceKey: vi.fn(async () => exact),
      findPotentialMatches: vi.fn(async () => potential),
    },
    { align },
  );
  return { planner, align };
}

describe("Event candidate planning", () => {
  it("never calls Jev on an exact official source identity", async () => {
    const { planner, align } = setup(
      event({ sourceKey: "skiyaki:cynhn.com:123" }),
      [],
    );
    const result = await planner.planEvent(source, draft());
    expect(result.deterministicMatchStatus).toBe("matched");
    expect(result.resolvedEventId).toBe("event-1");
    expect(result.semanticMatchStatus).toBe("not_used");
    expect(align).not.toHaveBeenCalled();
  });

  it("resolves differently titled multi-group official notices by unique time and venue", async () => {
    const { planner, align } = setup(null, [event()]);
    const result = await planner.planEvent(source, draft());
    expect(result.deterministicMatchStatus).toBe("matched");
    expect(result.resolvedEventId).toBe("event-1");
    expect(align).not.toHaveBeenCalled();
  });

  it("calls Jev only after deterministic evidence remains ambiguous", async () => {
    const evidence = {
      decisionKind: "event_alignment",
      version: "v1",
      provider: "jev",
      model: "test",
      choice: "event-2",
      confidence: 0.91,
      referencedCandidateIds: ["event-1", "event-2"],
      inputFingerprint: "b".repeat(64),
    };
    const { planner, align } = setup(
      null,
      [event(), event({ id: "event-2" })],
      { status: "matched", eventId: "event-2", confidence: 0.91, evidence },
    );
    const result = await planner.planEvent(source, draft());
    expect(align).toHaveBeenCalledOnce();
    expect(result.semanticMatchStatus).toBe("matched");
    expect(result.resolvedEventId).toBe("event-2");
  });

  it("blocks a possible manual duplicate even if semantic alignment claims a match", async () => {
    const evidence = {
      decisionKind: "event_alignment",
      version: "v1",
      provider: "jev",
      model: "test",
      choice: "manual-event",
      confidence: 0.99,
      inputFingerprint: "c".repeat(64),
    };
    const { planner } = setup(
      null,
      [event({ id: "manual-event", sourceKey: null })],
      {
        status: "matched",
        eventId: "manual-event",
        confidence: 0.99,
        evidence,
      },
    );
    const result = await planner.planEvent(source, draft());
    expect(result.deterministicMatchStatus).toBe("ambiguous");
    expect(result.resolvedEventId).toBeNull();
    expect(
      deriveOfficialImportCandidateReviewStatus({
        deterministicMatchStatus:
          result.deterministicMatchStatus ?? "unresolved",
        semanticMatchStatus: result.semanticMatchStatus ?? "not_used",
      }),
    ).toBe("blocked_for_identity_review");
  });

  it("fails closed when the semantic provider is unavailable", async () => {
    const { planner } = setup(null, [event(), event({ id: "event-2" })]);
    const result = await planner.planEvent(source, draft());
    expect(result.semanticMatchStatus).toBe("low_confidence");
    expect(result.resolvedEventId).toBeNull();
    expect(
      deriveOfficialImportCandidateReviewStatus({
        deterministicMatchStatus:
          result.deterministicMatchStatus ?? "unresolved",
        semanticMatchStatus: result.semanticMatchStatus ?? "not_used",
      }),
    ).toBe("blocked_for_identity_review");
  });

  it("preserves an explicit ambiguous semantic decision", async () => {
    const evidence = {
      decisionKind: "event_alignment",
      version: "v1",
      provider: "jev",
      model: "test",
      choice: "ambiguous",
      confidence: 0.9,
      inputFingerprint: "d".repeat(64),
    };
    const { planner } = setup(null, [event(), event({ id: "event-2" })], {
      status: "ambiguous",
      evidence,
    });
    const result = await planner.planEvent(source, draft());
    expect(result.semanticMatchStatus).toBe("ambiguous");
    expect(result.jevDecisionEvidence).toEqual(evidence);
  });
});
