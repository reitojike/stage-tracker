import type { EventDurableCandidate } from "@stage-tracker/official-import/durable-candidate";
import { describe, expect, it, vi } from "vitest";
import {
  ProviderUnavailableFailure,
  SourceFetchFailure,
  type AcquisitionDraft,
  type OfficialImportCandidatePlanner,
  type OfficialSourceAdapter,
} from "./acquisition";
import {
  executeOfficialImportShadowRun,
  OFFICIAL_IMPORT_BUSY_RETRY_AFTER_MS,
  OfficialImportAttemptRetryError,
  type OfficialImportStagingRepository,
  type RunFailureClassification,
  type RunPreparation,
} from "./shadow-execution";
import { requireEnabledShadowSource } from "./source-registry";

const SENTINEL = "RAW_SENTINEL_MUST_NOT_PERSIST";
const RUN_ID = "00000000-0000-4000-8000-000000000001";
const ATTEMPT_TOKEN = "a".repeat(64);

function repositoryHarness() {
  const eventCandidates: EventDurableCandidate[] = [];
  let recordedFailure: RunFailureClassification | null = null;
  const commitCandidates = vi.fn<
    OfficialImportStagingRepository["commitCandidates"]
  >(async (_runId, _sourceId, _attemptToken, candidates) => {
    for (const candidate of candidates) {
      if (candidate.candidateKind === "event") eventCandidates.push(candidate);
    }
    return candidates.length;
  });
  const releaseRun = vi.fn<OfficialImportStagingRepository["releaseRun"]>(
    async () => "released",
  );
  const failRun = vi.fn<OfficialImportStagingRepository["failRun"]>(
    async (_runId, _sourceId, _attemptToken, classification) => {
      recordedFailure = classification;
      return "failed";
    },
  );
  const prepareRun = vi.fn<OfficialImportStagingRepository["prepareRun"]>(
    async () =>
      recordedFailure === null
        ? { status: "ready" }
        : {
            status: "failed",
            failureClassification: recordedFailure,
          },
  );
  const repository: OfficialImportStagingRepository = {
    prepareRun,
    commitCandidates,
    releaseRun,
    failRun,
  };
  return {
    repository,
    eventCandidates,
    prepareRun,
    commitCandidates,
    releaseRun,
    failRun,
  };
}

function deferredAcquisition() {
  let finish: () => void = () => {
    throw new Error("acquisition was not started");
  };
  let fail: (error: Error) => void = () => {
    throw new Error("acquisition was not started");
  };
  const promise = new Promise<readonly AcquisitionDraft[]>(
    (resolve, reject) => {
      finish = () => resolve([]);
      fail = reject;
    },
  );
  return {
    adapter: { acquire: () => promise },
    finish: () => finish(),
    fail: (error: Error) => fail(error),
  };
}

const unusedPlanner: OfficialImportCandidatePlanner = {
  async planEvent() {
    throw new Error("not used");
  },
  async planTicketOpportunity() {
    throw new Error("not used");
  },
};

describe("official import shadow execution", () => {
  it("refreshes the same attempt lease during slow acquisition", async () => {
    const source = requireEnabledShadowSource("event.kabuki-bito.schedule");
    const harness = repositoryHarness();
    const deferred = deferredAcquisition();
    const execution = executeOfficialImportShadowRun(
      RUN_ID,
      ATTEMPT_TOKEN,
      source,
      deferred.adapter,
      unusedPlanner,
      harness.repository,
      10,
    );
    await vi.waitFor(() =>
      expect(harness.prepareRun.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    deferred.finish();
    await expect(execution).resolves.toMatchObject({ status: "completed" });
  });

  it("does not publish candidates after losing a lease renewal", async () => {
    const source = requireEnabledShadowSource("event.kabuki-bito.schedule");
    const harness = repositoryHarness();
    harness.prepareRun
      .mockResolvedValueOnce({ status: "ready" })
      .mockResolvedValueOnce({ status: "busy" });
    const deferred = deferredAcquisition();
    const execution = executeOfficialImportShadowRun(
      RUN_ID,
      ATTEMPT_TOKEN,
      source,
      deferred.adapter,
      unusedPlanner,
      harness.repository,
      10,
    );
    await vi.waitFor(() =>
      expect(harness.prepareRun.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    deferred.finish();
    await expect(execution).rejects.toMatchObject({
      reason: "ownership_lost",
    });
    expect(harness.commitCandidates).not.toHaveBeenCalled();
  });

  it("drains an in-flight renewal before releasing a transient failure", async () => {
    const source = requireEnabledShadowSource("event.kabuki-bito.schedule");
    const harness = repositoryHarness();
    let finishRenewal: (result: RunPreparation) => void = () => {
      throw new Error("renewal was not started");
    };
    const renewal = new Promise<RunPreparation>((resolve) => {
      finishRenewal = resolve;
    });
    harness.prepareRun
      .mockResolvedValueOnce({ status: "ready" })
      .mockReturnValueOnce(renewal);
    const deferred = deferredAcquisition();
    const execution = executeOfficialImportShadowRun(
      RUN_ID,
      ATTEMPT_TOKEN,
      source,
      deferred.adapter,
      unusedPlanner,
      harness.repository,
      10,
    );
    await vi.waitFor(() =>
      expect(harness.prepareRun.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    deferred.fail(new SourceFetchFailure());
    await Promise.resolve();
    expect(harness.releaseRun).not.toHaveBeenCalled();
    finishRenewal({ status: "ready" });
    await expect(execution).rejects.toMatchObject({ reason: "source_fetch" });
    expect(harness.releaseRun).toHaveBeenCalledOnce();
    const callsAfterRelease = harness.prepareRun.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(harness.prepareRun).toHaveBeenCalledTimes(callsAfterRelease);
  });

  it("keeps synthetic raw acquisition data out of durable output and commit payload", async () => {
    const source = requireEnabledShadowSource("event.kabuki-bito.schedule");
    const adapter: OfficialSourceAdapter = {
      async acquire() {
        const rawHtml = `<html>${SENTINEL}</html>`;
        const proposal = {
          sourceKey: "kabuki:example-1",
          title: "Example Event",
          startsOn: "2026-10-01",
          endsOn: "2026-10-01",
          occurrences: [{ startsAt: "2026-10-01T13:00:00+09:00" }],
          raw_html: rawHtml,
          body: rawHtml,
          content: rawHtml,
        };
        const drafts: AcquisitionDraft[] = [
          {
            candidateKind: "event",
            canonicalUrl: "https://www.kabuki-bito.jp/schedule/example/",
            officialExternalId: "example-1",
            observedAt: "2026-09-22T00:00:00.000Z",
            contentHash: "a".repeat(64),
            proposal,
          },
        ];
        return drafts;
      },
    };
    const planner: OfficialImportCandidatePlanner = {
      async planEvent(_source, draft) {
        expect(JSON.stringify(draft)).not.toContain(SENTINEL);
        return {
          planFingerprint: "b".repeat(64),
          plan: {
            action: "create",
            detailsChanged: false,
            rangeChanged: false,
            newOccurrences: [{}],
          },
        };
      },
      async planTicketOpportunity() {
        throw new Error("not used");
      },
    };
    const harness = repositoryHarness();

    const result = await executeOfficialImportShadowRun(
      RUN_ID,
      ATTEMPT_TOKEN,
      source,
      adapter,
      planner,
      harness.repository,
    );

    expect(result).toEqual({
      status: "completed",
      runId: RUN_ID,
      sourceId: source.id,
      candidateCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
    expect(harness.eventCandidates).toHaveLength(1);
    expect(JSON.stringify(harness.eventCandidates[0])).not.toContain(SENTINEL);
    expect(harness.commitCandidates).toHaveBeenCalledOnce();
    expect(harness.failRun).not.toHaveBeenCalled();
  });

  it("releases ownership and retries a transient fetch failure", async () => {
    const source = requireEnabledShadowSource("event.kabuki-bito.schedule");
    const harness = repositoryHarness();
    await expect(
      executeOfficialImportShadowRun(
        RUN_ID,
        ATTEMPT_TOKEN,
        source,
        {
          acquire() {
            throw new SourceFetchFailure();
          },
        },
        {
          planEvent: vi.fn(),
          planTicketOpportunity: vi.fn(),
        },
        harness.repository,
      ),
    ).rejects.toMatchObject({ reason: "source_fetch" });

    expect(harness.eventCandidates).toHaveLength(0);
    expect(harness.commitCandidates).not.toHaveBeenCalled();
    expect(harness.releaseRun).toHaveBeenCalledWith(
      RUN_ID,
      source.id,
      ATTEMPT_TOKEN,
    );
    expect(harness.failRun).not.toHaveBeenCalled();
  });

  it("releases ownership and retries an unavailable source provider", async () => {
    const source = requireEnabledShadowSource("event.kabuki-bito.schedule");
    const harness = repositoryHarness();

    await expect(
      executeOfficialImportShadowRun(
        RUN_ID,
        ATTEMPT_TOKEN,
        source,
        {
          acquire() {
            throw new ProviderUnavailableFailure();
          },
        },
        {
          planEvent: vi.fn(),
          planTicketOpportunity: vi.fn(),
        },
        harness.repository,
      ),
    ).rejects.toMatchObject({ reason: "provider_unavailable" });
    expect(harness.releaseRun).toHaveBeenCalledWith(
      RUN_ID,
      source.id,
      ATTEMPT_TOKEN,
    );
    expect(harness.failRun).not.toHaveBeenCalled();
  });

  it("rejects an arbitrary proposal source URL before staging", async () => {
    const source = requireEnabledShadowSource("event.kabuki-bito.schedule");
    const harness = repositoryHarness();
    const result = await executeOfficialImportShadowRun(
      RUN_ID,
      ATTEMPT_TOKEN,
      source,
      {
        async acquire() {
          return [
            {
              candidateKind: "event",
              canonicalUrl: source.canonicalUrl,
              observedAt: "2026-09-22T00:00:00.000Z",
              contentHash: "a".repeat(64),
              proposal: {
                sourceKey: "kabuki:example-1",
                title: "Example Event",
                sourceUrl: "https://attacker.example/source",
                startsOn: "2026-10-01",
                endsOn: "2026-10-01",
                occurrences: [],
              },
            },
          ];
        },
      },
      {
        async planEvent() {
          return {
            planFingerprint: "b".repeat(64),
            plan: {
              action: "create",
              detailsChanged: false,
              rangeChanged: false,
            },
          };
        },
        async planTicketOpportunity() {
          throw new Error("not used");
        },
      },
      harness.repository,
    );

    expect(result).toMatchObject({
      status: "failed",
      failureClassification: "validation",
    });
    expect(harness.failRun).toHaveBeenCalledWith(
      RUN_ID,
      source.id,
      ATTEMPT_TOKEN,
      "validation",
    );
    expect(harness.eventCandidates).toHaveLength(0);
  });

  it("validates the entire acquisition batch before one atomic staging call", async () => {
    const source = requireEnabledShadowSource("event.kabuki-bito.schedule");
    const harness = repositoryHarness();
    const result = await executeOfficialImportShadowRun(
      RUN_ID,
      ATTEMPT_TOKEN,
      source,
      {
        async acquire() {
          return [
            {
              candidateKind: "event" as const,
              canonicalUrl: "https://www.kabuki-bito.jp/schedule/valid-first/",
              observedAt: "2026-09-22T00:00:00.000Z",
              contentHash: "a".repeat(64),
              proposal: {
                sourceKey: "kabuki:valid-first",
                title: "Valid first draft",
                startsOn: "2026-10-01",
                endsOn: "2026-10-01",
                occurrences: [],
              },
            },
            {
              candidateKind: "event" as const,
              canonicalUrl: "https://attacker.example/invalid-second",
              observedAt: "2026-09-22T00:00:00.000Z",
              contentHash: "b".repeat(64),
              proposal: {
                sourceKey: "kabuki:invalid-second",
                title: "Invalid second draft",
                startsOn: "2026-10-02",
                endsOn: "2026-10-02",
                occurrences: [],
              },
            },
          ];
        },
      },
      {
        async planEvent() {
          return {
            planFingerprint: "c".repeat(64),
            plan: {
              action: "create",
              detailsChanged: false,
              rangeChanged: false,
            },
          };
        },
        async planTicketOpportunity() {
          throw new Error("not used");
        },
      },
      harness.repository,
    );

    expect(result).toMatchObject({
      status: "failed",
      failureClassification: "validation",
    });
    expect(harness.commitCandidates).not.toHaveBeenCalled();
    expect(harness.eventCandidates).toHaveLength(0);
    expect(harness.failRun).toHaveBeenCalledWith(
      RUN_ID,
      source.id,
      ATTEMPT_TOKEN,
      "validation",
    );
  });

  it("publishes the planner-resolved Event source key for Ticket candidates", async () => {
    const source = requireEnabledShadowSource("ticket.shochiku.schedule");
    const harness = repositoryHarness();
    const result = await executeOfficialImportShadowRun(
      RUN_ID,
      ATTEMPT_TOKEN,
      source,
      {
        async acquire() {
          return [
            {
              candidateKind: "ticket_opportunity",
              canonicalUrl:
                "https://www1.ticket-web-shochiku.com/t/info/sale_schedule_east.html",
              observedAt: "2026-09-22T00:00:00.000Z",
              contentHash: "a".repeat(64),
              eventReference: {
                title: "Example Event",
                venue: "Example Theater",
                startsOn: "2026-10-01",
                endsOn: "2026-10-02",
              },
              proposal: {
                eventSourceKey: "unresolved:example",
                sourceKey: "shochiku:example:general",
                displayName: "一般販売",
                targetScope: "event_wide",
                milestones: [],
              },
            },
          ];
        },
      },
      {
        async planEvent() {
          throw new Error("not used");
        },
        async planTicketOpportunity(_source, draft) {
          return {
            proposal: {
              ...draft.proposal,
              eventSourceKey: "kabuki-bito:example",
            },
            planFingerprint: "b".repeat(64),
            deterministicMatchStatus: "matched",
            semanticMatchStatus: "not_used",
            resolvedEventId: "event-1",
            plan: {
              action: "create",
              eventChanged: false,
              detailsChanged: false,
              occurrencesChanged: false,
              milestonesChanged: false,
            },
          };
        },
      },
      harness.repository,
    );

    expect(result.status).toBe("completed");
    const candidates = harness.commitCandidates.mock.calls[0]?.[3];
    expect(candidates?.[0]?.proposal).toMatchObject({
      eventSourceKey: "kabuki-bito:example",
    });
  });

  it("reuses a completed step-derived run without acquiring or restaging", async () => {
    const source = requireEnabledShadowSource("event.kabuki-bito.schedule");
    const harness = repositoryHarness();
    harness.repository.prepareRun = vi.fn<
      OfficialImportStagingRepository["prepareRun"]
    >(async () => ({ status: "completed", candidateCount: 2 }));
    const acquire = vi.fn<OfficialSourceAdapter["acquire"]>();

    const result = await executeOfficialImportShadowRun(
      RUN_ID,
      ATTEMPT_TOKEN,
      source,
      { acquire },
      {
        planEvent: vi.fn(),
        planTicketOpportunity: vi.fn(),
      },
      harness.repository,
    );

    expect(result).toEqual({
      status: "completed",
      runId: RUN_ID,
      sourceId: source.id,
      candidateCount: 2,
    });
    expect(acquire).not.toHaveBeenCalled();
    expect(harness.commitCandidates).not.toHaveBeenCalled();
  });

  it("backs off beyond the active lease when another attempt owns the run", async () => {
    const source = requireEnabledShadowSource("event.kabuki-bito.schedule");
    const harness = repositoryHarness();
    harness.repository.prepareRun = vi.fn<
      OfficialImportStagingRepository["prepareRun"]
    >(async () => ({ status: "busy" }));
    const acquire = vi.fn<OfficialSourceAdapter["acquire"]>();

    await expect(
      executeOfficialImportShadowRun(
        RUN_ID,
        ATTEMPT_TOKEN,
        source,
        { acquire },
        {
          planEvent: vi.fn(),
          planTicketOpportunity: vi.fn(),
        },
        harness.repository,
      ),
    ).rejects.toMatchObject({
      reason: "busy",
      retryAfterMs: OFFICIAL_IMPORT_BUSY_RETRY_AFTER_MS,
    });
    expect(acquire).not.toHaveBeenCalled();
    expect(harness.releaseRun).not.toHaveBeenCalled();
    expect(harness.failRun).not.toHaveBeenCalled();
  });

  it("does not overwrite a terminal result after losing attempt ownership", async () => {
    const source = requireEnabledShadowSource("event.kabuki-bito.schedule");
    const harness = repositoryHarness();
    harness.failRun.mockResolvedValueOnce("completed");

    await expect(
      executeOfficialImportShadowRun(
        RUN_ID,
        ATTEMPT_TOKEN,
        source,
        {
          async acquire() {
            return [
              {
                candidateKind: "event",
                canonicalUrl: source.canonicalUrl,
                observedAt: "2026-09-22T00:00:00.000Z",
                contentHash: "a".repeat(64),
                proposal: {
                  sourceKey: "kabuki:impossible-date",
                  title: "Impossible date",
                  startsOn: "2026-02-30",
                  endsOn: "2026-02-30",
                  occurrences: [],
                },
              },
            ];
          },
        },
        {
          planEvent: vi.fn(),
          planTicketOpportunity: vi.fn(),
        },
        harness.repository,
      ),
    ).rejects.toEqual(new OfficialImportAttemptRetryError("ownership_lost"));
  });

  it("returns the canonical failure recorded by the terminal owner", async () => {
    const source = requireEnabledShadowSource("event.kabuki-bito.schedule");
    const harness = repositoryHarness();
    harness.failRun.mockResolvedValueOnce("failed");
    harness.repository.prepareRun = vi
      .fn<OfficialImportStagingRepository["prepareRun"]>()
      .mockResolvedValueOnce({ status: "ready" })
      .mockResolvedValueOnce({
        status: "failed",
        failureClassification: "source_parse",
      });

    const result = await executeOfficialImportShadowRun(
      RUN_ID,
      ATTEMPT_TOKEN,
      source,
      {
        async acquire() {
          return [
            {
              candidateKind: "event",
              canonicalUrl: source.canonicalUrl,
              observedAt: "2026-09-22T00:00:00.000Z",
              contentHash: "a".repeat(64),
              proposal: {
                sourceKey: "kabuki:impossible-date",
                title: "Impossible date",
                startsOn: "2026-02-30",
                endsOn: "2026-02-30",
                occurrences: [],
              },
            },
          ];
        },
      },
      {
        planEvent: vi.fn(),
        planTicketOpportunity: vi.fn(),
      },
      harness.repository,
    );

    expect(result).toMatchObject({
      status: "failed",
      failureClassification: "source_parse",
    });
  });
});
