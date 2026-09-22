import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/data/database.types";

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ createPrivilegedIngestionClient: vi.fn() }));

const { createEventMatchRepository } = await import("./event-match-repository");

describe("Event match repository", () => {
  it("includes canceled occurrences when resolving current Event facts", async () => {
    const requestedUrls: URL[] = [];
    const client = createClient<Database>(
      "https://example.test",
      "public-test-key",
      {
        global: {
          fetch: async (input) => {
            const url = new URL(String(input));
            requestedUrls.push(url);
            switch (url.pathname) {
              case "/rest/v1/events":
                return Response.json({
                  id: "event-1",
                  source_key: "official:event-1",
                  title: "Event",
                  venue: "Hall",
                  source_url: "https://example.test/event-1",
                  memo: null,
                  genre_id: null,
                  starts_on: "2026-10-01",
                  ends_on: "2026-10-01",
                  current_genre: null,
                });
              case "/rest/v1/event_occurrences":
                return Response.json([
                  {
                    starts_at: "2026-10-01T09:00:00Z",
                    doors_at: null,
                    ends_at: null,
                  },
                  {
                    starts_at: "2026-10-01T12:00:00Z",
                    doors_at: null,
                    ends_at: null,
                  },
                ]);
              case "/rest/v1/event_groups":
                return Response.json([]);
              default:
                throw new Error(`Unexpected catalog request: ${url.pathname}`);
            }
          },
        },
      },
    );

    const event =
      await createEventMatchRepository(client).findExactBySourceKey(
        "official:event-1",
      );

    expect(event?.occurrences).toHaveLength(2);
    expect(
      requestedUrls
        .find((url) => url.pathname === "/rest/v1/events")
        ?.searchParams.get("canceled_at"),
    ).toBe("is.null");
    expect(
      requestedUrls
        .find((url) => url.pathname === "/rest/v1/event_occurrences")
        ?.searchParams.has("canceled_at"),
    ).toBe(false);
  });
});
