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
const kabukiSource = getOfficialSource("event.kabuki-bito.schedule");
if (kabukiSource === null) throw new Error("test Kabuki source missing");

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
    sourceUrl: "https://group-b.example/events/987",
    memo: null,
    genreId: null,
    genreKey: null,
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

  it("changes the fingerprint when material current Event facts drift", async () => {
    const current = event({ sourceKey: "skiyaki:cynhn.com:123" });
    const before = await setup(current, []).planner.planEvent(source, draft());
    const after = await setup(
      event({ ...current, memo: "operator changed this after review" }),
      [],
    ).planner.planEvent(source, draft());

    expect(after.plan.action).toBe(before.plan.action);
    expect(after.planFingerprint).not.toBe(before.planFingerprint);
  });

  it("surfaces every P1 Event write category in the review plan", async () => {
    const result = await setup(
      event({ sourceKey: "skiyaki:cynhn.com:123" }),
      [],
    ).planner.planEvent(
      source,
      draft({
        sourceUrl: "https://cynhn.com/contents/changed",
        memo: "new memo",
        genre: "idol",
        groups: [{ key: "cynhn", displayName: "CYNHN" }],
        occurrences: [
          {
            startsAt: "2026-10-10T18:00:00+09:00",
            doorsAt: "2026-10-10T17:30:00+09:00",
            endsAt: "2026-10-10T20:00:00+09:00",
          },
        ],
      }),
    );

    expect(result.plan).toMatchObject({
      action: "update",
      detailsChanged: true,
      endsAtFixes: [expect.any(Object)],
      doorsAtFixes: [expect.any(Object)],
      genrePlan: { changed: true },
      groupsPlan: { changed: true },
    });
  });

  it("proposes a reviewed end-time correction when the published timetable replaces an earlier estimate", async () => {
    const current = event({
      sourceKey: "skiyaki:cynhn.com:123",
      occurrences: [
        {
          startsAt: "2026-10-10T18:00:00+09:00",
          doorsAt: null,
          endsAt: "2026-10-10T20:35:00+09:00",
        },
      ],
    });
    const result = await setup(current, []).planner.planEvent(
      source,
      draft({
        occurrences: [
          {
            startsAt: "2026-10-10T18:00:00+09:00",
            endsAt: "2026-10-10T20:49:00+09:00",
          },
        ],
      }),
    );
    expect(result.plan.endsAtFixes).toEqual([
      expect.objectContaining({
        from: "2026-10-10T20:35:00+09:00",
        endsAt: "2026-10-10T20:49:00+09:00",
      }),
    ]);
  });

  it("holds a Kabuki play when a previously published end disappears", async () => {
    const sourceKey = "kabuki-bito:kabukiza:play:985";
    const current = event({
      sourceKey,
      occurrences: [
        {
          startsAt: "2026-10-10T18:00:00+09:00",
          doorsAt: null,
          endsAt: "2026-10-10T20:35:00+09:00",
        },
      ],
    });
    const proposal = draft({
      sourceKey,
      occurrences: [
        { startsAt: "2026-10-10T18:00:00+09:00", endsAt: null },
      ],
    });
    const result = await setup(current, []).planner.planEvent(
      kabukiSource,
      proposal,
    );
    expect(result.holdReason).toBe("published_end_missing");
    expect(result.plan.endsAtFixes).toEqual([]);

    const withExactEnd = await setup(current, []).planner.planEvent(
      kabukiSource,
      draft({
        sourceKey,
        occurrences: [
          {
            startsAt: "2026-10-10T18:00:00+09:00",
            endsAt: "2026-10-10T20:49:00+09:00",
          },
        ],
      }),
    );
    expect(withExactEnd.holdReason).toBeUndefined();
    expect(withExactEnd.plan.endsAtFixes).toHaveLength(1);
    const otherSource = await setup(current, []).planner.planEvent(
      source,
      proposal,
    );
    expect(otherSource.holdReason).toBeUndefined();
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
