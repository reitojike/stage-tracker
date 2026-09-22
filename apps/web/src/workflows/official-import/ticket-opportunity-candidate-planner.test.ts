import { describe, expect, it, vi } from "vitest";
import type { TicketOpportunityAcquisitionDraft } from "./acquisition";
import { deriveOfficialImportCandidateReviewStatus } from "./candidate-review";
import type {
  CatalogEventMatch,
  EventAlignmentResult,
} from "./event-candidate-planner";
import { getOfficialSource } from "./source-registry";
import {
  createTicketOpportunityCandidatePlanner,
  type CatalogTicketOpportunityMatch,
} from "./ticket-opportunity-candidate-planner";

const source = getOfficialSource("ticket.shochiku.schedule");
if (source === null) throw new Error("test source missing");

function event(overrides: Partial<CatalogEventMatch> = {}): CatalogEventMatch {
  return {
    id: "event-1",
    sourceKey: "kabuki-bito:kabukiza:play:123",
    title: "秀山祭九月大歌舞伎",
    venue: "歌舞伎座",
    startsOn: "2026-09-02",
    endsOn: "2026-09-26",
    occurrences: [],
    groups: [],
    ...overrides,
  };
}

function draft(
  eventSourceKey = "unresolved:shochiku:2026:kabukiza",
): TicketOpportunityAcquisitionDraft {
  return {
    candidateKind: "ticket_opportunity",
    canonicalUrl:
      "https://www1.ticket-web-shochiku.com/t/info/sale_schedule_east.html",
    observedAt: "2026-09-22T00:00:00.000Z",
    contentHash: "a".repeat(64),
    eventReference: {
      title: "秀山祭九月大歌舞伎",
      venue: "歌舞伎座",
      startsOn: "2026-09-02",
      endsOn: "2026-09-26",
    },
    proposal: {
      eventSourceKey,
      sourceKey: "shochiku:2026:kabukiza:shuzansai:general",
      displayName: "一般販売",
      sourceUrl:
        "https://www1.ticket-web-shochiku.com/t/info/sale_schedule_east.html",
      targetScope: "event_wide",
      milestones: [
        { type: "sale_start", precision: "date", date: "2026-08-14" },
      ],
    },
  };
}

function setup(
  exact: CatalogEventMatch | null,
  potential: readonly CatalogEventMatch[],
  alignment: EventAlignmentResult = { status: "unavailable" },
  opportunity: CatalogTicketOpportunityMatch | null = null,
) {
  const align = vi.fn(async () => alignment);
  const findOpportunity = vi.fn(async () => opportunity);
  const planner = createTicketOpportunityCandidatePlanner(
    {
      findExactBySourceKey: vi.fn(async () => exact),
      findPotentialMatches: vi.fn(async () => potential),
    },
    { findExactBySourceKey: findOpportunity },
    { align },
  );
  return { planner, align, findOpportunity };
}

describe("Ticket Opportunity candidate planning", () => {
  it("uses exact Event identity without Jev and preserves it in the proposal", async () => {
    const matched = event();
    const { planner, align } = setup(matched, []);
    if (matched.sourceKey === null) throw new Error("test source key missing");
    const result = await planner.planTicketOpportunity(
      source,
      draft(matched.sourceKey),
    );
    expect(result.resolvedEventId).toBe("event-1");
    expect(result.proposal?.eventSourceKey).toBe(matched.sourceKey);
    expect(result.semanticMatchStatus).toBe("not_used");
    expect(align).not.toHaveBeenCalled();
  });

  it("resolves one exact title, venue, and range deterministically", async () => {
    const { planner, align } = setup(null, [event()]);
    const result = await planner.planTicketOpportunity(source, draft());
    expect(result.deterministicMatchStatus).toBe("matched");
    expect(result.proposal?.eventSourceKey).toBe(
      "kabuki-bito:kabukiza:play:123",
    );
    expect(align).not.toHaveBeenCalled();
  });

  it("uses current replace-all semantics when diffing an existing opportunity", async () => {
    const matched = event();
    const current: CatalogTicketOpportunityMatch = {
      id: "opportunity-1",
      eventId: matched.id,
      displayName: "一般販売",
      targetScope: "event_wide",
      sourceUrl:
        "https://www1.ticket-web-shochiku.com/t/info/sale_schedule_east.html",
      memo: null,
      targetOccurrences: [],
      milestones: [
        {
          type: "sale_start",
          precision: "date",
          date: "2026-08-14",
          at: null,
          startsAt: null,
          endsAt: null,
        },
      ],
    };
    if (matched.sourceKey === null) throw new Error("test source key missing");
    const { planner } = setup(
      null,
      [matched],
      { status: "unavailable" },
      current,
    );
    const result = await planner.planTicketOpportunity(source, draft());
    expect(result.resolvedTicketOpportunityId).toBe("opportunity-1");
    expect(result.plan).toMatchObject({
      action: "unchanged",
      eventChanged: false,
      detailsChanged: false,
      occurrencesChanged: false,
      milestonesChanged: false,
    });
  });

  it("blocks an unresolved Event before any apply-capable candidate", async () => {
    const { planner, findOpportunity } = setup(null, []);
    const result = await planner.planTicketOpportunity(source, draft());
    expect(result.resolvedEventId).toBeNull();
    expect(result.semanticMatchStatus).toBe("low_confidence");
    expect(findOpportunity).not.toHaveBeenCalled();
    expect(
      deriveOfficialImportCandidateReviewStatus({
        deterministicMatchStatus:
          result.deterministicMatchStatus ?? "unresolved",
        semanticMatchStatus: result.semanticMatchStatus ?? "not_used",
      }),
    ).toBe("blocked_for_identity_review");
  });

  it("keeps a semantic no-match blocked because Ticket requires an Event", async () => {
    const evidence = {
      decisionKind: "event_alignment",
      version: "v1",
      provider: "jev",
      model: "test",
      choice: "no_match",
      confidence: 0.99,
      inputFingerprint: "b".repeat(64),
    };
    const { planner } = setup(
      null,
      [event(), event({ id: "event-2", sourceKey: "other:event" })],
      { status: "unmatched", evidence },
    );
    const result = await planner.planTicketOpportunity(source, draft());
    expect(result.resolvedEventId).toBeNull();
    expect(result.semanticMatchStatus).toBe("low_confidence");
    expect(result.jevDecisionEvidence).toEqual(evidence);
  });
});
