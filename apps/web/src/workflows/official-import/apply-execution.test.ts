import { describe, expect, it, vi } from "vitest";
import type { OfficialImportCandidatePlanner } from "./acquisition";
import {
  executeOfficialImportCandidateApply,
  OFFICIAL_IMPORT_APPLY_BUSY_RETRY_AFTER_MS,
  OfficialImportApplyAttemptRetryError,
  OfficialImportCatalogFailure,
  type CandidateApplyFailureClassification,
  type OfficialImportApplyCandidate,
  type OfficialImportApplyRepository,
  type OfficialImportCatalogApplyPlan,
  type OfficialImportCatalogGateway,
} from "./apply-execution";

const CANDIDATE_ID = "00000000-0000-4000-8000-000000000101";
const REVIEWER_ID = "00000000-0000-4000-8000-000000000102";
const ATTEMPT_TOKEN = "a".repeat(64);

function eventCandidate(
  overrides: Partial<OfficialImportApplyCandidate> = {},
): OfficialImportApplyCandidate {
  return {
    id: CANDIDATE_ID,
    sourceId: "event.kabuki-bito.schedule",
    candidateKind: "event",
    canonicalUrl: "https://www.kabuki-bito.jp/schedule/example/",
    officialExternalId: "example",
    observedAt: "2026-09-23T00:00:00.000Z",
    contentHash: "b".repeat(64),
    etag: null,
    lastModified: null,
    proposalVersion: "event.v1",
    proposal: {
      sourceKey: "kabuki-bito:example",
      title: "Example Event",
      venue: "Example Theater",
      sourceUrl: "https://www.kabuki-bito.jp/schedule/example/",
      startsOn: "2026-10-01",
      endsOn: "2026-10-01",
      occurrences: [{ startsAt: "2026-10-01T18:00:00+09:00" }],
    },
    evidenceLocator: {},
    planFingerprint: "reviewed-event-fingerprint",
    deterministicMatchStatus: "matched",
    semanticMatchStatus: "not_used",
    resolvedEventId: "event-1",
    resolvedTicketOpportunityId: null,
    reviewerId: REVIEWER_ID,
    ...overrides,
  };
}

function ticketCandidate(
  overrides: Partial<OfficialImportApplyCandidate> = {},
): OfficialImportApplyCandidate {
  return {
    id: CANDIDATE_ID,
    sourceId: "ticket.shochiku.schedule",
    candidateKind: "ticket_opportunity",
    canonicalUrl:
      "https://www1.ticket-web-shochiku.com/t/info/sale_schedule_east.html",
    officialExternalId: "example-ticket",
    observedAt: "2026-09-23T00:00:00.000Z",
    contentHash: "c".repeat(64),
    etag: null,
    lastModified: null,
    proposalVersion: "ticket_opportunity.v1",
    proposal: {
      eventSourceKey: "kabuki-bito:example",
      sourceKey: "shochiku:example:general",
      displayName: "一般販売",
      sourceUrl:
        "https://www1.ticket-web-shochiku.com/t/info/sale_schedule_east.html",
      targetScope: "event_wide",
      milestones: [
        { type: "sale_start", precision: "date", date: "2026-09-01" },
      ],
    },
    evidenceLocator: {},
    planFingerprint: "reviewed-ticket-fingerprint",
    deterministicMatchStatus: "matched",
    semanticMatchStatus: "not_used",
    resolvedEventId: "event-1",
    resolvedTicketOpportunityId: "ticket-1",
    reviewerId: REVIEWER_ID,
    ...overrides,
  };
}

function repositoryHarness(candidate: OfficialImportApplyCandidate) {
  let failureClassification: CandidateApplyFailureClassification | null = null;
  const prepareCandidate = vi.fn<
    OfficialImportApplyRepository["prepareCandidate"]
  >(async () => ({ status: "ready", candidate }));
  const completeCandidate = vi.fn<
    OfficialImportApplyRepository["completeCandidate"]
  >(async () => "applied");
  const failCandidate = vi.fn<OfficialImportApplyRepository["failCandidate"]>(
    async (_candidateId, _attemptToken, classification) => {
      failureClassification = classification;
      return "failed";
    },
  );
  return {
    repository: { prepareCandidate, completeCandidate, failCandidate },
    prepareCandidate,
    completeCandidate,
    failCandidate,
    getFailureClassification: () => failureClassification,
  };
}

function catalogPlan(
  overrides: Partial<OfficialImportCatalogApplyPlan> = {},
): OfficialImportCatalogApplyPlan {
  return {
    action: "update",
    hasChanges: true,
    resolvedEventId: "event-1",
    resolvedTicketOpportunityId: null,
    apply: vi.fn(async () => undefined),
    ...overrides,
  };
}

function setup(candidate: OfficialImportApplyCandidate) {
  const harness = repositoryHarness(candidate);
  const eventPlan = catalogPlan();
  const ticketPlan = catalogPlan({
    resolvedTicketOpportunityId: "ticket-1",
  });
  const planner: OfficialImportCandidatePlanner = {
    planEvent: vi.fn<OfficialImportCandidatePlanner["planEvent"]>(async () => ({
      planFingerprint: "reviewed-event-fingerprint",
      deterministicMatchStatus: "matched",
      semanticMatchStatus: "not_used",
      resolvedEventId: "event-1",
      plan: {
        action: "update",
        detailsChanged: true,
        rangeChanged: false,
      },
    })),
    planTicketOpportunity: vi.fn<
      OfficialImportCandidatePlanner["planTicketOpportunity"]
    >(async () => ({
      planFingerprint: "reviewed-ticket-fingerprint",
      deterministicMatchStatus: "matched",
      semanticMatchStatus: "not_used",
      resolvedEventId: "event-1",
      resolvedTicketOpportunityId: "ticket-1",
      plan: {
        action: "update",
        eventChanged: false,
        detailsChanged: true,
        occurrencesChanged: false,
        milestonesChanged: false,
      },
    })),
  };
  const catalog: OfficialImportCatalogGateway = {
    prepareEvent: vi.fn(async () => eventPlan),
    prepareTicketOpportunity: vi.fn(async () => ticketPlan),
  };
  return { ...harness, planner, catalog, eventPlan, ticketPlan };
}

describe("approved official import apply execution", () => {
  it("freshly replans and applies an Event through the shared catalog gateway", async () => {
    const candidate = eventCandidate();
    const harness = setup(candidate);

    await expect(
      executeOfficialImportCandidateApply(
        CANDIDATE_ID,
        ATTEMPT_TOKEN,
        harness.planner,
        harness.repository,
        harness.catalog,
      ),
    ).resolves.toEqual({
      status: "applied",
      candidateId: CANDIDATE_ID,
      outcome: "written",
    });
    expect(harness.planner.planEvent).toHaveBeenCalledOnce();
    expect(harness.catalog.prepareEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKey: "kabuki-bito:example" }),
      REVIEWER_ID,
      "event-1",
    );
    expect(harness.eventPlan.apply).toHaveBeenCalledOnce();
    expect(harness.completeCandidate).toHaveBeenCalledWith(
      CANDIDATE_ID,
      ATTEMPT_TOKEN,
    );
    expect(harness.failCandidate).not.toHaveBeenCalled();
  });

  it("freshly replans and applies a Ticket Opportunity without a personal-state path", async () => {
    const harness = setup(ticketCandidate());

    const result = await executeOfficialImportCandidateApply(
      CANDIDATE_ID,
      ATTEMPT_TOKEN,
      harness.planner,
      harness.repository,
      harness.catalog,
    );

    expect(result).toMatchObject({ status: "applied", outcome: "written" });
    expect(harness.planner.planTicketOpportunity).toHaveBeenCalledOnce();
    expect(harness.catalog.prepareTicketOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKey: "shochiku:example:general" }),
    );
    expect(harness.ticketPlan.apply).toHaveBeenCalledOnce();
    expect(harness.eventPlan.apply).not.toHaveBeenCalled();
  });

  it("applies a manually bound ticket only to the reviewed Event", async () => {
    const harness = setup(
      ticketCandidate({
        proposal: {
          eventSourceKey: "unresolved:shochiku:example",
          sourceKey: "shochiku:example:general",
          displayName: "一般販売",
          sourceUrl:
            "https://www1.ticket-web-shochiku.com/t/info/sale_schedule_east.html",
          targetScope: "event_wide",
          milestones: [
            { type: "sale_start", precision: "date", date: "2026-09-01" },
          ],
        },
        planFingerprint: "unresolved-plan",
        deterministicMatchStatus: "unresolved",
        semanticMatchStatus: "low_confidence",
        resolvedEventId: null,
        resolvedTicketOpportunityId: null,
        manualEventBinding: {
          eventId: "event-1",
          eventSourceKey: "kabuki-bito:example",
        },
      }),
    );
    vi.mocked(harness.planner.planTicketOpportunity).mockResolvedValueOnce({
      planFingerprint: "bound-create-plan",
      deterministicMatchStatus: "matched",
      semanticMatchStatus: "not_used",
      resolvedEventId: "event-1",
      resolvedTicketOpportunityId: null,
      plan: {
        action: "create",
        eventChanged: false,
        detailsChanged: true,
        occurrencesChanged: false,
        milestonesChanged: true,
      },
    });
    Object.assign(harness.ticketPlan, {
      action: "create",
      resolvedTicketOpportunityId: null,
    });

    const result = await executeOfficialImportCandidateApply(
      CANDIDATE_ID,
      ATTEMPT_TOKEN,
      harness.planner,
      harness.repository,
      harness.catalog,
    );

    expect(result).toMatchObject({ status: "applied", outcome: "written" });
    const plannedDraft = vi.mocked(harness.planner.planTicketOpportunity).mock
      .calls[0]?.[1];
    expect(plannedDraft?.proposal.eventSourceKey).toBe("kabuki-bito:example");
    expect(harness.catalog.prepareTicketOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({ eventSourceKey: "kabuki-bito:example" }),
    );
    expect(harness.ticketPlan.apply).toHaveBeenCalledOnce();
  });

  it("holds an unreviewed update to an existing ticket after manual Event binding", async () => {
    const harness = setup(
      ticketCandidate({
        planFingerprint: "unresolved-plan",
        deterministicMatchStatus: "unresolved",
        semanticMatchStatus: "low_confidence",
        resolvedEventId: null,
        resolvedTicketOpportunityId: null,
        manualEventBinding: {
          eventId: "event-1",
          eventSourceKey: "kabuki-bito:example",
        },
      }),
    );

    const result = await executeOfficialImportCandidateApply(
      CANDIDATE_ID,
      ATTEMPT_TOKEN,
      harness.planner,
      harness.repository,
      harness.catalog,
    );

    expect(result).toMatchObject({
      status: "failed",
      failureClassification: "source_changed",
    });
    expect(harness.ticketPlan.apply).not.toHaveBeenCalled();
  });

  it("holds a manually bound ticket if its existing source identity points elsewhere", async () => {
    const harness = setup(
      ticketCandidate({
        semanticMatchStatus: "low_confidence",
        manualEventBinding: {
          eventId: "event-1",
          eventSourceKey: "kabuki-bito:example",
        },
      }),
    );
    vi.mocked(harness.planner.planTicketOpportunity).mockResolvedValueOnce({
      planFingerprint: "changed",
      deterministicMatchStatus: "matched",
      semanticMatchStatus: "not_used",
      resolvedEventId: "event-1",
      resolvedTicketOpportunityId: "ticket-1",
      plan: {
        action: "update",
        eventChanged: true,
        detailsChanged: false,
        occurrencesChanged: false,
        milestonesChanged: false,
      },
    });
    const result = await executeOfficialImportCandidateApply(
      CANDIDATE_ID,
      ATTEMPT_TOKEN,
      harness.planner,
      harness.repository,
      harness.catalog,
    );
    expect(result).toMatchObject({
      status: "failed",
      failureClassification: "identity_ambiguous",
    });
    expect(harness.ticketPlan.apply).not.toHaveBeenCalled();
  });

  it("returns an idempotent no-op before reading or planning an already applied candidate", async () => {
    const harness = setup(eventCandidate());
    harness.prepareCandidate.mockResolvedValueOnce({ status: "applied" });

    await expect(
      executeOfficialImportCandidateApply(
        CANDIDATE_ID,
        ATTEMPT_TOKEN,
        harness.planner,
        harness.repository,
        harness.catalog,
      ),
    ).resolves.toMatchObject({
      status: "applied",
      outcome: "already_applied",
    });
    expect(harness.planner.planEvent).not.toHaveBeenCalled();
    expect(harness.completeCandidate).not.toHaveBeenCalled();
  });

  it("fails closed without planning when the candidate is not approved", async () => {
    const harness = setup(eventCandidate());
    harness.prepareCandidate.mockResolvedValueOnce({ status: "not_approved" });

    await expect(
      executeOfficialImportCandidateApply(
        CANDIDATE_ID,
        ATTEMPT_TOKEN,
        harness.planner,
        harness.repository,
        harness.catalog,
      ),
    ).resolves.toEqual({ status: "not_approved", candidateId: CANDIDATE_ID });
    expect(harness.planner.planEvent).not.toHaveBeenCalled();
  });

  it("backs off beyond the lease while another attempt owns the candidate", async () => {
    const harness = setup(eventCandidate());
    harness.prepareCandidate.mockResolvedValueOnce({ status: "busy" });

    await expect(
      executeOfficialImportCandidateApply(
        CANDIDATE_ID,
        ATTEMPT_TOKEN,
        harness.planner,
        harness.repository,
        harness.catalog,
      ),
    ).rejects.toMatchObject({
      reason: "busy",
      retryAfterMs: OFFICIAL_IMPORT_APPLY_BUSY_RETRY_AFTER_MS,
    });
  });

  it("records source_changed without writing when the reviewed fingerprint drifts", async () => {
    const harness = setup(eventCandidate());
    vi.mocked(harness.planner.planEvent).mockResolvedValueOnce({
      planFingerprint: "fresh-different-fingerprint",
      deterministicMatchStatus: "matched",
      semanticMatchStatus: "not_used",
      resolvedEventId: "event-1",
      plan: {
        action: "update",
        detailsChanged: true,
        rangeChanged: false,
      },
    });

    await expect(
      executeOfficialImportCandidateApply(
        CANDIDATE_ID,
        ATTEMPT_TOKEN,
        harness.planner,
        harness.repository,
        harness.catalog,
      ),
    ).resolves.toEqual({
      status: "failed",
      candidateId: CANDIDATE_ID,
      failureClassification: "source_changed",
    });
    expect(harness.eventPlan.apply).not.toHaveBeenCalled();
    expect(harness.getFailureClassification()).toBe("source_changed");
  });

  it("marks a changed fingerprint converged when the exact proposal is already current", async () => {
    const candidate = eventCandidate({ resolvedEventId: null });
    const harness = setup(candidate);
    vi.mocked(harness.planner.planEvent).mockResolvedValueOnce({
      planFingerprint: "fresh-converged-fingerprint",
      deterministicMatchStatus: "matched",
      semanticMatchStatus: "not_used",
      resolvedEventId: "event-1",
      plan: {
        action: "unchanged",
        detailsChanged: false,
        rangeChanged: false,
      },
    });
    Object.assign(harness.eventPlan, {
      action: "unchanged" as const,
      hasChanges: false,
    });

    await expect(
      executeOfficialImportCandidateApply(
        CANDIDATE_ID,
        ATTEMPT_TOKEN,
        harness.planner,
        harness.repository,
        harness.catalog,
      ),
    ).resolves.toMatchObject({ status: "applied", outcome: "converged" });
    expect(harness.eventPlan.apply).toHaveBeenCalledOnce();
    expect(harness.completeCandidate).toHaveBeenCalledOnce();
  });

  it("does not complete a converged retry when the locked catalog recheck finds drift", async () => {
    const candidate = eventCandidate({ resolvedEventId: null });
    const harness = setup(candidate);
    vi.mocked(harness.planner.planEvent).mockResolvedValueOnce({
      planFingerprint: "fresh-converged-fingerprint",
      deterministicMatchStatus: "matched",
      semanticMatchStatus: "not_used",
      resolvedEventId: "event-1",
      plan: {
        action: "unchanged",
        detailsChanged: false,
        rangeChanged: false,
      },
    });
    Object.assign(harness.eventPlan, {
      action: "unchanged" as const,
      hasChanges: false,
      apply: vi.fn(async () => {
        throw new OfficialImportCatalogFailure("source_changed");
      }),
    });

    await expect(
      executeOfficialImportCandidateApply(
        CANDIDATE_ID,
        ATTEMPT_TOKEN,
        harness.planner,
        harness.repository,
        harness.catalog,
      ),
    ).resolves.toMatchObject({
      status: "failed",
      failureClassification: "source_changed",
    });
    expect(harness.completeCandidate).not.toHaveBeenCalled();
  });

  it("never applies a Jev-only identity even after human approval", async () => {
    const harness = setup(
      eventCandidate({
        deterministicMatchStatus: "unresolved",
        semanticMatchStatus: "matched",
      }),
    );
    vi.mocked(harness.planner.planEvent).mockResolvedValueOnce({
      planFingerprint: "semantic-only",
      deterministicMatchStatus: "unresolved",
      semanticMatchStatus: "matched",
      resolvedEventId: "event-1",
      plan: {
        action: "update",
        detailsChanged: false,
        rangeChanged: false,
      },
    });

    const result = await executeOfficialImportCandidateApply(
      CANDIDATE_ID,
      ATTEMPT_TOKEN,
      harness.planner,
      harness.repository,
      harness.catalog,
    );

    expect(result).toMatchObject({
      status: "failed",
      failureClassification: "identity_ambiguous",
    });
    expect(harness.catalog.prepareEvent).not.toHaveBeenCalled();
    expect(harness.eventPlan.apply).not.toHaveBeenCalled();
  });

  it("rejects a planner/core target mismatch before catalog write", async () => {
    const harness = setup(eventCandidate());
    Object.assign(harness.eventPlan, { resolvedEventId: "event-2" });

    const result = await executeOfficialImportCandidateApply(
      CANDIDATE_ID,
      ATTEMPT_TOKEN,
      harness.planner,
      harness.repository,
      harness.catalog,
    );

    expect(result).toMatchObject({
      status: "failed",
      failureClassification: "identity_ambiguous",
    });
    expect(harness.eventPlan.apply).not.toHaveBeenCalled();
  });

  it("records invalid durable proposal state without fabricating a catalog write", async () => {
    const harness = setup(
      eventCandidate({ proposal: { title: "missing required fields" } }),
    );

    const result = await executeOfficialImportCandidateApply(
      CANDIDATE_ID,
      ATTEMPT_TOKEN,
      harness.planner,
      harness.repository,
      harness.catalog,
    );

    expect(result).toMatchObject({
      status: "failed",
      failureClassification: "validation",
    });
    expect(harness.planner.planEvent).not.toHaveBeenCalled();
    expect(harness.eventPlan.apply).not.toHaveBeenCalled();
  });

  it("retries after a successful idempotent write when completion loses ownership", async () => {
    const harness = setup(eventCandidate());
    harness.completeCandidate.mockResolvedValueOnce("not_owner");

    await expect(
      executeOfficialImportCandidateApply(
        CANDIDATE_ID,
        ATTEMPT_TOKEN,
        harness.planner,
        harness.repository,
        harness.catalog,
      ),
    ).rejects.toEqual(
      new OfficialImportApplyAttemptRetryError("ownership_lost"),
    );
    expect(harness.eventPlan.apply).toHaveBeenCalledOnce();
    expect(harness.failCandidate).not.toHaveBeenCalled();
  });

  it("retries without recording failure when completion recording throws after a write", async () => {
    const harness = setup(eventCandidate());
    harness.completeCandidate.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(
      executeOfficialImportCandidateApply(
        CANDIDATE_ID,
        ATTEMPT_TOKEN,
        harness.planner,
        harness.repository,
        harness.catalog,
      ),
    ).rejects.toEqual(
      new OfficialImportApplyAttemptRetryError("ownership_lost"),
    );
    expect(harness.eventPlan.apply).toHaveBeenCalledOnce();
    expect(harness.failCandidate).not.toHaveBeenCalled();
  });
});
