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

  it("pages past 1,000 occurrence and group match facts without truncating the review fingerprint", async () => {
    const requestedOffsets: number[] = [];
    const occurrences = Array.from({ length: 1_001 }, (_, index) => ({
      starts_at: new Date(
        Date.parse("2026-10-01T09:00:00Z") + index * 60_000,
      ).toISOString(),
      doors_at: null,
      ends_at: null,
    }));
    const groups = Array.from({ length: 1_001 }, (_, index) => ({
      groups: { key: `group-${index}`, display_name: `Group ${index}` },
    }));
    const client = createClient<Database>(
      "https://example.test",
      "public-test-key",
      {
        global: {
          fetch: async (input) => {
            const url = new URL(String(input));
            if (url.pathname === "/rest/v1/events")
              return Response.json({
                id: "event-1",
                source_key: "official:event-1",
                title: "Event",
                venue: "Hall",
                source_url: null,
                memo: null,
                genre_id: null,
                starts_on: "2026-10-01",
                ends_on: "2026-10-01",
                current_genre: null,
              });
            const offset = Number(url.searchParams.get("offset") ?? "0");
            const limit = Number(url.searchParams.get("limit") ?? "1000");
            requestedOffsets.push(offset);
            if (url.pathname === "/rest/v1/event_occurrences")
              return Response.json(occurrences.slice(offset, offset + limit));
            if (url.pathname === "/rest/v1/event_groups")
              return Response.json(groups.slice(offset, offset + limit));
            throw new Error(`Unexpected catalog request: ${url.pathname}`);
          },
        },
      },
    );

    const event =
      await createEventMatchRepository(client).findExactBySourceKey(
        "official:event-1",
      );
    expect(event?.occurrences).toHaveLength(1_001);
    expect(event?.groups).toHaveLength(1_001);
    expect(requestedOffsets).toContain(1_000);
  });
});
