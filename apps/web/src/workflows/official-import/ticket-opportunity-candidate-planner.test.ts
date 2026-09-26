import { describe, expect, it, vi } from "vitest";
import type { TicketOpportunityAcquisitionDraft } from "./acquisition";
import { deriveOfficialImportCandidateReviewStatus } from "./candidate-review";
import type {
  CatalogEventMatch,
  EventAlignmentResult,
  EventMatchRepository,
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
    sourceUrl: "https://www.kabuki-bito.jp/theaters/kabukiza/play/123",
    memo: null,
    genreId: null,
    genreKey: null,
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
  const findPotentialMatches = vi.fn<
    EventMatchRepository["findPotentialMatches"]
  >(async () => potential);
  const planner = createTicketOpportunityCandidatePlanner(
    {
      findExactBySourceKey: vi.fn(async () => exact),
      findById: vi.fn(async () => exact),
      findPotentialMatches,
    },
    { findExactBySourceKey: findOpportunity },
    { align },
  );
  return { planner, align, findOpportunity, findPotentialMatches };
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

  it("resolves one exact venue and range deterministically", async () => {
    const { planner, align, findPotentialMatches } = setup(null, [event()]);
    const result = await planner.planTicketOpportunity(source, draft());
    expect(result.deterministicMatchStatus).toBe("matched");
    expect(result.proposal?.eventSourceKey).toBe(
      "kabuki-bito:kabukiza:play:123",
    );
    expect(align).not.toHaveBeenCalled();
    const prefilter = findPotentialMatches.mock.calls[0]?.[2];
    expect(prefilter).toEqual(expect.any(Function));
    expect(
      prefilter?.({ title: "秀山祭九月大歌舞伎", venue: "歌舞伎座" }),
    ).toBe(true);
    expect(prefilter?.({ title: "別公演", venue: "歌舞伎座" })).toBe(true);
    expect(prefilter?.({ title: "秀山祭九月大歌舞伎", venue: "南座" })).toBe(
      false,
    );
  });

  it("uses a known Kabuki Event identity despite observed Minamiza title and venue variants", async () => {
    const matched = event({
      sourceKey: "kabuki-bito:kyoto:play:955",
      title: "流白浪燦星",
      venue: "劇場：南座",
    });
    const proposal = draft();
    const { planner } = setup(matched, []);
    const result = await planner.planTicketOpportunity(source, {
      ...proposal,
      proposal: {
        ...proposal.proposal,
        eventSourceKey: matched.sourceKey ?? "",
        displayName: "一般発売",
      },
      eventReference: {
        title: "流白浪燦星 碧翠の麗城",
        venue: "京都四條南座",
        startsOn: matched.startsOn,
        endsOn: matched.endsOn,
      },
    });
    expect(result.deterministicMatchStatus).toBe("matched");
    expect(result.proposal).toMatchObject({
      eventSourceKey: "kabuki-bito:kyoto:play:955",
      sourceKey: "shochiku:kabuki-bito:kyoto:play:955:general",
      displayName: "一般発売",
    });
  });

  it("binds an observed title variant when venue and full period uniquely agree", async () => {
    const matched = event({ title: "流白浪燦星", venue: "南座" });
    const proposal = draft();
    const { planner } = setup(null, [matched]);
    const result = await planner.planTicketOpportunity(source, {
      ...proposal,
      eventReference: {
        title: "流白浪燦星 碧翠の麗城",
        venue: "南座",
        startsOn: matched.startsOn,
        endsOn: matched.endsOn,
      },
    });
    expect(result.deterministicMatchStatus).toBe("matched");
    expect(result.semanticMatchStatus).toBe("not_used");
    expect(result.resolvedEventId).toBe(matched.id);
  });

  it("does not bind a changed period, even with the same venue and title", async () => {
    const matched = event({
      title: "九月博多座特別公演",
      venue: "博多座",
      startsOn: "2026-09-03",
      endsOn: "2026-09-14",
    });
    const proposal = draft();
    const { planner } = setup(null, [matched]);
    const result = await planner.planTicketOpportunity(source, {
      ...proposal,
      eventReference: {
        title: matched.title,
        venue: matched.venue,
        startsOn: "2026-09-04",
        endsOn: matched.endsOn,
      },
    });
    expect(result.deterministicMatchStatus).not.toBe("matched");
    expect(result.resolvedEventId).toBeNull();
  });

  it("reuses a human-reviewed binding on later scans with a changed period", async () => {
    const matched = event({
      title: "九月博多座特別公演",
      venue: "博多座",
      startsOn: "2026-09-03",
      endsOn: "2026-09-14",
    });
    const { align, findOpportunity, findPotentialMatches } = setup(null, []);
    const planner = createTicketOpportunityCandidatePlanner(
      {
        findExactBySourceKey: vi.fn(async (key) =>
          key === matched.sourceKey ? matched : null,
        ),
        findById: vi.fn(async (id) => (id === matched.id ? matched : null)),
        findPotentialMatches,
      },
      { findExactBySourceKey: findOpportunity },
      { align },
      {
        find: vi.fn(async () => ({
          eventId: matched.id,
          eventSourceKey: matched.sourceKey ?? "",
        })),
      },
    );
    const proposal = draft();
    const result = await planner.planTicketOpportunity(source, {
      ...proposal,
      eventReference: {
        title: matched.title,
        venue: matched.venue,
        startsOn: "2026-09-04",
        endsOn: matched.endsOn,
      },
    });
    expect(result.resolvedEventId).toBe(matched.id);
    expect(result.semanticMatchStatus).toBe("not_used");
    expect(align).not.toHaveBeenCalled();
  });

  it("reuses a reviewed binding to a manual Event without inventing a source key", async () => {
    const matched = event({ sourceKey: null, title: "俳優祭" });
    const { align, findOpportunity, findPotentialMatches } = setup(null, []);
    const planner = createTicketOpportunityCandidatePlanner(
      {
        findExactBySourceKey: vi.fn(async () => null),
        findById: vi.fn(async (id) => (id === matched.id ? matched : null)),
        findPotentialMatches,
      },
      { findExactBySourceKey: findOpportunity },
      { align },
      {
        find: vi.fn(async () => ({
          eventId: matched.id,
          eventSourceKey: null,
        })),
      },
    );

    const result = await planner.planTicketOpportunity(source, draft());
    expect(result.resolvedEventId).toBe(matched.id);
    expect(result.deterministicMatchStatus).toBe("matched");
    expect(result.proposal?.eventSourceKey).toBe(
      "unresolved:shochiku:2026:kabukiza",
    );
    expect(align).not.toHaveBeenCalled();
  });

  it("holds a reviewed binding whose Event identity has changed", async () => {
    const other = event({ id: "event-2" });
    const unavailable: EventAlignmentResult = { status: "unavailable" };
    const { findOpportunity, findPotentialMatches } = setup(null, []);
    const planner = createTicketOpportunityCandidatePlanner(
      {
        findExactBySourceKey: vi.fn(async (key) =>
          key === other.sourceKey ? other : null,
        ),
        findById: vi.fn(async () => other),
        findPotentialMatches,
      },
      { findExactBySourceKey: findOpportunity },
      { align: vi.fn(async () => unavailable) },
      {
        find: vi.fn(async () => ({
          eventId: "event-1",
          eventSourceKey: "kabuki-bito:kabukiza:play:123",
        })),
      },
    );
    const result = await planner.planTicketOpportunity(source, draft());
    expect(result.deterministicMatchStatus).toBe("ambiguous");
    expect(result.resolvedEventId).toBeNull();
  });

  it("holds a ticket if a new exact identity conflicts with its reviewed binding", async () => {
    const manual = event({ sourceKey: null });
    const unavailable: EventAlignmentResult = { status: "unavailable" };
    const newlyImported = event({
      id: "event-2",
      sourceKey: "kabuki-bito:kabukiza:play:456",
    });
    const { findOpportunity, findPotentialMatches } = setup(null, []);
    const planner = createTicketOpportunityCandidatePlanner(
      {
        findExactBySourceKey: vi.fn(async () => newlyImported),
        findById: vi.fn(async () => manual),
        findPotentialMatches,
      },
      { findExactBySourceKey: findOpportunity },
      { align: vi.fn(async () => unavailable) },
      {
        find: vi.fn(async () => ({ eventId: manual.id, eventSourceKey: null })),
      },
    );

    const result = await planner.planTicketOpportunity(
      source,
      draft(newlyImported.sourceKey ?? ""),
    );
    expect(result.deterministicMatchStatus).toBe("ambiguous");
    expect(result.resolvedEventId).toBeNull();
  });

  it("holds two Events with the same venue and period for human review", async () => {
    const first = event({ title: "第一部" });
    const second = event({
      id: "event-2",
      sourceKey: "kabuki-bito:kabukiza:play:124",
      title: "第二部",
    });
    const { planner } = setup(null, [first, second]);
    const result = await planner.planTicketOpportunity(source, draft());
    expect(result.deterministicMatchStatus).toBe("ambiguous");
    expect(result.resolvedEventId).toBeNull();
  });

  it("keeps an explicit Kabuki clock when Shochiku later lists only the same sale date", async () => {
    const matched = event();
    const current: CatalogTicketOpportunityMatch = {
      id: "opportunity-1",
      eventId: matched.id,
      displayName: "一般販売",
      targetScope: "event_wide",
      sourceUrl: "https://www.kabuki-bito.jp/theaters/kabukiza/play/123",
      memo: null,
      targetOccurrences: [],
      milestones: [
        {
          type: "sale_start",
          precision: "datetime",
          date: null,
          at: "2026-08-14T10:00:00+09:00",
          startsAt: null,
          endsAt: null,
        },
      ],
    };
    const { planner } = setup(matched, [], undefined, current);
    const result = await planner.planTicketOpportunity(source, {
      ...draft(matched.sourceKey ?? ""),
      proposal: {
        ...draft().proposal,
        displayName: "一般販売",
      },
    });
    expect(result.proposal?.sourceKey).toBe(
      "shochiku:kabuki-bito:kabukiza:play:123:general",
    );
    expect(result.plan).toMatchObject({
      action: "unchanged",
      milestonesChanged: false,
    });
    const changed = await planner.planTicketOpportunity(source, {
      ...draft(matched.sourceKey ?? ""),
      proposal: {
        ...draft().proposal,
        displayName: "一般販売",
        milestones: [
          { type: "sale_start", precision: "date", date: "2026-08-15" },
        ],
      },
    });
    expect(changed.plan).toMatchObject({
      action: "update",
      milestonesChanged: true,
    });
  });

  it("upgrades a same-day Kabuki date-only notice to Shochiku evidence", async () => {
    const matched = event();
    const { planner } = setup(matched, [], undefined, {
      id: "opportunity-1",
      eventId: matched.id,
      displayName: "チケット発売予定",
      targetScope: "event_wide",
      sourceUrl: "https://www.kabuki-bito.jp/theaters/kabukiza/play/123",
      memo: "公式ページでは発売予定。承認前に最新情報を確認",
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
    });
    const result = await planner.planTicketOpportunity(
      source,
      draft(matched.sourceKey ?? ""),
    );
    expect(result.plan).toMatchObject({
      action: "update",
      detailsChanged: true,
    });
  });

  it("does not downgrade an applied Shochiku general sale when only the Kabuki preliminary remains", async () => {
    const matched = event();
    const { planner } = setup(matched, [], undefined, {
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
          date: "2026-08-15",
          at: null,
          startsAt: null,
          endsAt: null,
        },
      ],
    });
    const preliminary = draft(matched.sourceKey ?? "");
    const result = await planner.planTicketOpportunity(source, {
      ...preliminary,
      canonicalUrl: "https://www.kabuki-bito.jp/theaters/kabukiza/play/123",
      proposal: {
        ...preliminary.proposal,
        sourceUrl: "https://www.kabuki-bito.jp/theaters/kabukiza/play/123",
      },
    });
    expect(result.proposal?.sourceKey).toBe(
      "shochiku:kabuki-bito:kabukiza:play:123:general",
    );
    expect(result.plan?.action).toBe("unchanged");
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

  it("changes the fingerprint when material current Opportunity facts drift", async () => {
    const matched = event();
    if (matched.sourceKey === null) throw new Error("test source key missing");
    const current: CatalogTicketOpportunityMatch = {
      id: "opportunity-1",
      eventId: matched.id,
      displayName: "一般販売",
      targetScope: "event_wide",
      sourceUrl: draft().proposal.sourceUrl ?? null,
      memo: null,
      targetOccurrences: [],
      milestones: [],
    };
    const before = await setup(
      matched,
      [],
      undefined,
      current,
    ).planner.planTicketOpportunity(source, draft(matched.sourceKey));
    const after = await setup(matched, [], undefined, {
      ...current,
      memo: "operator changed this after review",
    }).planner.planTicketOpportunity(source, draft(matched.sourceKey));

    expect(after.plan.action).toBe(before.plan.action);
    expect(after.planFingerprint).not.toBe(before.planFingerprint);
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

  it("blocks deterministic matching when a manual possible duplicate exists", async () => {
    const official = event();
    const manual = event({ id: "event-manual", sourceKey: null });
    const { planner, align, findOpportunity } = setup(null, [official, manual]);

    const result = await planner.planTicketOpportunity(source, draft());

    expect(result.deterministicMatchStatus).toBe("ambiguous");
    expect(result.semanticMatchStatus).toBe("low_confidence");
    expect(result.resolvedEventId).toBeNull();
    expect(align).toHaveBeenCalledOnce();
    expect(findOpportunity).not.toHaveBeenCalled();
  });
});
