import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/data/database.types";

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ createPrivilegedIngestionClient: vi.fn() }));

const { createEventMatchRepository } = await import("./event-match-repository");

describe("Event match repository", () => {
  it("filters a 42-Event ticket window before hydrating the one matching Event", async () => {
    const requestedUrls: URL[] = [];
    const summaries = Array.from({ length: 42 }, (_, index) => ({
      id: `event-${index}`,
      title: index === 41 ? "秀山祭九月大歌舞伎" : `別公演${index}`,
      venue: index === 41 ? "歌舞伎座" : "別会場",
    }));
    const client = createClient<Database>(
      "https://example.test",
      "public-test-key",
      {
        global: {
          fetch: async (input) => {
            const url = new URL(String(input));
            requestedUrls.push(url);
            if (url.pathname === "/rest/v1/events") {
              if (url.searchParams.get("select") === "id,title,venue")
                return Response.json(summaries);
              expect(url.searchParams.get("id")).toBe("in.(event-41)");
              return Response.json([
                {
                  ...summaries[41],
                  source_key: "kabuki-bito:kabukiza:play:123",
                  source_url:
                    "https://www.kabuki-bito.jp/theaters/kabukiza/play/123",
                  memo: null,
                  genre_id: null,
                  starts_on: "2026-09-02",
                  ends_on: "2026-09-26",
                  current_genre: null,
                },
              ]);
            }
            if (
              url.pathname === "/rest/v1/event_occurrences" ||
              url.pathname === "/rest/v1/event_groups"
            )
              return Response.json([]);
            throw new Error(`Unexpected catalog request: ${url.pathname}`);
          },
        },
      },
    );

    const matches = await createEventMatchRepository(
      client,
    ).findPotentialMatches(
      "2026-09-02",
      "2026-09-26",
      (event) =>
        event.title === "秀山祭九月大歌舞伎" && event.venue === "歌舞伎座",
    );

    expect(matches.map((match) => match.id)).toEqual(["event-41"]);
    expect(
      requestedUrls.filter((url) => url.pathname === "/rest/v1/events"),
    ).toHaveLength(3);
    expect(
      requestedUrls.filter(
        (url) => url.pathname === "/rest/v1/event_occurrences",
      ),
    ).toHaveLength(1);
  });

  it("fails closed when another matching Event appears during hydration", async () => {
    let summaryReads = 0;
    const client = createClient<Database>(
      "https://example.test",
      "public-test-key",
      {
        global: {
          fetch: async (input) => {
            const url = new URL(String(input));
            if (url.pathname === "/rest/v1/events") {
              if (url.searchParams.get("select") === "id,title,venue") {
                summaryReads += 1;
                return Response.json(
                  summaryReads === 1
                    ? [{ id: "event-1", title: "公演", venue: "歌舞伎座" }]
                    : [
                        { id: "event-1", title: "公演", venue: "歌舞伎座" },
                        { id: "event-2", title: "公演", venue: "歌舞伎座" },
                      ],
                );
              }
              return Response.json([
                {
                  id: "event-1",
                  title: "公演",
                  venue: "歌舞伎座",
                  source_key: null,
                  source_url: null,
                  memo: null,
                  genre_id: null,
                  starts_on: "2026-09-02",
                  ends_on: "2026-09-26",
                  current_genre: null,
                },
              ]);
            }
            if (
              url.pathname === "/rest/v1/event_occurrences" ||
              url.pathname === "/rest/v1/event_groups"
            )
              return Response.json([]);
            throw new Error(`Unexpected catalog request: ${url.pathname}`);
          },
        },
      },
    );

    await expect(
      createEventMatchRepository(client).findPotentialMatches(
        "2026-09-02",
        "2026-09-26",
        (event) => event.title === "公演" && event.venue === "歌舞伎座",
      ),
    ).rejects.toThrow("Ticket Event match set changed during hydration");
    expect(summaryReads).toBe(2);
  });

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

  it("finds an active manual Event by id", async () => {
    const requestedUrls: URL[] = [];
    const client = createClient<Database>(
      "https://example.test",
      "public-test-key",
      {
        global: {
          fetch: async (input) => {
            const url = new URL(String(input));
            requestedUrls.push(url);
            if (url.pathname === "/rest/v1/events")
              return Response.json({
                id: "manual-event-1",
                source_key: null,
                title: "俳優祭",
                venue: "歌舞伎座",
                source_url: "https://actors.or.jp/wp/news/340/",
                memo: null,
                genre_id: null,
                starts_on: "2026-10-26",
                ends_on: "2026-10-26",
                current_genre: null,
              });
            if (
              url.pathname === "/rest/v1/event_occurrences" ||
              url.pathname === "/rest/v1/event_groups"
            )
              return Response.json([]);
            throw new Error(`Unexpected catalog request: ${url.pathname}`);
          },
        },
      },
    );

    const event =
      await createEventMatchRepository(client).findById("manual-event-1");
    expect(event?.sourceKey).toBeNull();
    const eventRequest = requestedUrls.find(
      (url) => url.pathname === "/rest/v1/events",
    );
    expect(eventRequest?.searchParams.get("id")).toBe("eq.manual-event-1");
    expect(eventRequest?.searchParams.get("canceled_at")).toBe("is.null");
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
