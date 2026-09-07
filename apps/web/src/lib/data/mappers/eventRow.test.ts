import { describe, expect, it } from "vitest";
import {
  mapEventRow,
  mapOccurrenceRow,
  type EventRow,
  type OccurrenceRow,
} from "./eventRow";

const eventId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const occurrenceId = "33333333-3333-4333-8333-333333333333";

function baseEventRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: eventId,
    owner_id: ownerId,
    title: "テスト興行",
    venue: null,
    source_url: null,
    memo: null,
    starts_on: "2026-03-01",
    ends_on: "2026-03-10",
    canceled_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function baseOccurrenceRow(
  overrides: Partial<OccurrenceRow> = {},
): OccurrenceRow {
  return {
    id: occurrenceId,
    event_id: eventId,
    starts_at: "2026-03-05T10:00:00Z",
    ends_at: null,
    doors_at: null,
    canceled_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("mapEventRow", () => {
  it("maps a well-formed row to a domain Event (snake_case -> camelCase)", () => {
    const result = mapEventRow(baseEventRow({ venue: "帝国劇場" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        id: eventId,
        ownerId,
        title: "テスト興行",
        venue: "帝国劇場",
        startsOn: "2026-03-01",
        endsOn: "2026-03-10",
      });
    }
  });

  it("returns an error (never throws) for a row whose range is inverted", () => {
    const result = mapEventRow(
      baseEventRow({ starts_on: "2026-03-10", ends_on: "2026-03-01" }),
    );
    expect(result.ok).toBe(false);
  });

  it("returns an error (never throws) for a malformed id", () => {
    expect(() => mapEventRow(baseEventRow({ id: "not-a-uuid" }))).not.toThrow();
    const result = mapEventRow(baseEventRow({ id: "not-a-uuid" }));
    expect(result.ok).toBe(false);
  });
});

describe("mapOccurrenceRow", () => {
  it("maps a well-formed row to a domain Occurrence", () => {
    const result = mapOccurrenceRow(baseOccurrenceRow());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        id: occurrenceId,
        eventId,
        startsAt: "2026-03-05T10:00:00.000Z",
        endsAt: null,
        doorsAt: null,
      });
    }
  });

  it("returns an error (never throws) when doorsAt is after startsAt", () => {
    const result = mapOccurrenceRow(
      baseOccurrenceRow({
        doors_at: "2026-03-05T11:00:00Z",
        starts_at: "2026-03-05T10:00:00Z",
      }),
    );
    expect(result.ok).toBe(false);
  });
});
