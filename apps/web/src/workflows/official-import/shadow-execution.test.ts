import type { EventDurableCandidate } from "@stage-tracker/official-import/durable-candidate";
import { describe, expect, it, vi } from "vitest";
import {
  SourceFetchFailure,
  type AcquisitionDraft,
  type OfficialImportCandidatePlanner,
  type OfficialSourceAdapter,
} from "./acquisition";
import {
  executeOfficialImportShadowRun,
  type OfficialImportStagingRepository,
} from "./shadow-execution";
import { requireEnabledShadowSource } from "./source-registry";

const SENTINEL = "RAW_SENTINEL_MUST_NOT_PERSIST";

function repositoryHarness() {
  const eventCandidates: EventDurableCandidate[] = [];
  const completeRun = vi.fn<OfficialImportStagingRepository["completeRun"]>();
  const failRun = vi.fn<OfficialImportStagingRepository["failRun"]>();
  const repository: OfficialImportStagingRepository = {
    createRun: vi.fn(async () => "00000000-0000-4000-8000-000000000001"),
    async insertEventCandidate(candidate) {
      eventCandidates.push(candidate);
    },
    async insertTicketOpportunityCandidate() {},
    completeRun,
    failRun,
  };
  return { repository, eventCandidates, completeRun, failRun };
}

describe("official import shadow execution", () => {
  it("keeps synthetic raw acquisition data out of durable output and INSERT payload", async () => {
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
      source,
      adapter,
      planner,
      harness.repository,
    );

    expect(result).toEqual({
      status: "completed",
      runId: "00000000-0000-4000-8000-000000000001",
      sourceId: source.id,
      candidateCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
    expect(harness.eventCandidates).toHaveLength(1);
    expect(JSON.stringify(harness.eventCandidates[0])).not.toContain(SENTINEL);
    expect(harness.completeRun).toHaveBeenCalledOnce();
    expect(harness.failRun).not.toHaveBeenCalled();
  });

  it("fails closed on fetch failure without staging a candidate", async () => {
    const source = requireEnabledShadowSource("event.kabuki-bito.schedule");
    const harness = repositoryHarness();
    const result = await executeOfficialImportShadowRun(
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
    );

    expect(result).toMatchObject({
      status: "failed",
      failureClassification: "source_fetch",
    });
    expect(harness.eventCandidates).toHaveLength(0);
    expect(harness.completeRun).not.toHaveBeenCalled();
    expect(harness.failRun).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      "source_fetch",
    );
  });

  it("rejects an arbitrary proposal source URL before staging", async () => {
    const source = requireEnabledShadowSource("event.kabuki-bito.schedule");
    const harness = repositoryHarness();
    const result = await executeOfficialImportShadowRun(
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
    expect(harness.eventCandidates).toHaveLength(0);
  });
});
