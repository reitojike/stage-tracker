import { describe, expect, it, vi } from "vitest";
import type { EventAcquisitionDraft } from "../acquisition";
import type { CatalogEventMatch } from "../event-candidate-planner";

vi.mock("server-only", () => ({}));

const { createJevEventAligner } = await import("./jev-event-aligner");

const draft: EventAcquisitionDraft = {
  candidateKind: "event",
  canonicalUrl: "https://cynhn.com/contents/101",
  observedAt: "2026-09-22T00:00:00.000Z",
  contentHash: "a".repeat(64),
  proposal: {
    sourceKey: "skiyaki:cynhn.com:101",
    title: "Official title",
    venue: "Venue",
    startsOn: "2026-10-10",
    endsOn: "2026-10-10",
    occurrences: [{ startsAt: "2026-10-10T18:00:00+09:00" }],
  },
};

const candidate: CatalogEventMatch = {
  id: "event-1",
  sourceKey: "other:1",
  title: "Other official title",
  venue: "Venue",
  sourceUrl: null,
  memo: null,
  genreId: null,
  genreKey: null,
  startsOn: "2026-10-10",
  endsOn: "2026-10-10",
  occurrences: [
    { startsAt: "2026-10-10T18:00:00+09:00", doorsAt: null, endsAt: null },
  ],
  groups: [],
};

describe("Jev Event aligner", () => {
  it("does not call the provider when no key is configured", async () => {
    const fetcher = vi.fn();
    const result = await createJevEventAligner(undefined, fetcher).align(
      draft,
      [candidate],
    );
    expect(result).toEqual({ status: "unavailable" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("accepts only a high-confidence choice from the bounded candidate ids", async () => {
    let observedBody: BodyInit | null | undefined;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toBe("https://www.jevai.org/api/v1/decisions");
        observedBody = init?.body;
        return Response.json({
          code: 0,
          data: {
            answers: {
              event_alignment: { choice: "event-1", confidence: 0.91 },
            },
          },
        });
      },
    );
    const result = await createJevEventAligner("jev_test", fetcher).align(
      draft,
      [candidate],
    );
    expect(result.status).toBe("matched");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(String(observedBody))).not.toHaveProperty("rawHtml");
  });

  it("routes low confidence to review", async () => {
    const result = await createJevEventAligner("jev_test", async () =>
      Response.json({
        code: 0,
        data: {
          answers: {
            event_alignment: { choice: "event-1", confidence: 0.5 },
          },
        },
      }),
    ).align(draft, [candidate]);
    expect(result.status).toBe("low_confidence");
  });
});
