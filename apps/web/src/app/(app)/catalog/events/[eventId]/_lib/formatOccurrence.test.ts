import { describe, expect, it } from "vitest";
import {
  eventIdSchema,
  occurrenceIdSchema,
  type Occurrence,
} from "@stage-tracker/domain";
import {
  formatOccurrenceDateTime,
  formatOccurrenceDoors,
  formatOccurrenceEnds,
} from "./formatOccurrence";

function occurrence(overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    id: occurrenceIdSchema.parse("11111111-1111-4111-8111-111111111111"),
    eventId: eventIdSchema.parse("22222222-2222-4222-8222-222222222222"),
    doorsAt: null,
    startsAt: "2026-03-10T09:00:00.000Z" as Occurrence["startsAt"], // 2026-03-10 18:00 JST, a Tuesday
    endsAt: null,
    canceledAt: null,
    createdAt: "2026-01-01T00:00:00.000Z" as Occurrence["createdAt"],
    updatedAt: "2026-01-01T00:00:00.000Z" as Occurrence["updatedAt"],
    ...overrides,
  };
}

describe("formatOccurrenceDateTime", () => {
  it("renders the Asia/Tokyo wall-clock date, weekday, and time (fixed +9h)", () => {
    expect(formatOccurrenceDateTime(occurrence())).toBe(
      "2026年3月10日(火) 18:00",
    );
  });

  it("crosses the Tokyo calendar-day boundary correctly for a late-UTC instant", () => {
    // 2026-03-10T15:30:00Z = 2026-03-11 00:30 JST (a Wednesday).
    const value = occurrence({
      startsAt: "2026-03-10T15:30:00.000Z" as Occurrence["startsAt"],
    });
    expect(formatOccurrenceDateTime(value)).toBe("2026年3月11日(水) 00:30");
  });
});

describe("formatOccurrenceDoors", () => {
  it("returns null when doorsAt is not set (unpublished, a valid state)", () => {
    expect(formatOccurrenceDoors(occurrence())).toBeNull();
  });

  it("formats a set doorsAt", () => {
    const value = occurrence({
      doorsAt: "2026-03-10T08:30:00.000Z" as Occurrence["startsAt"],
    });
    expect(formatOccurrenceDoors(value)).toBe("開場 17:30");
  });
});

describe("formatOccurrenceEnds", () => {
  it("returns null when endsAt is not set (unknown end time, a valid state)", () => {
    expect(formatOccurrenceEnds(occurrence())).toBeNull();
  });

  it("formats a set endsAt", () => {
    const value = occurrence({
      endsAt: "2026-03-10T11:00:00.000Z" as Occurrence["startsAt"],
    });
    expect(formatOccurrenceEnds(value)).toBe("終演 20:00");
  });

  it("marks a next-day end instead of showing a misleading bare time", () => {
    const value = occurrence({
      startsAt: "2026-03-10T14:00:00.000Z" as Occurrence["startsAt"],
      endsAt: "2026-03-10T16:00:00.000Z" as Occurrence["startsAt"],
    });
    expect(formatOccurrenceEnds(value)).toBe("終演 01:00（翌日）");
  });

  it("shows the actual date when an end is more than one Tokyo day later", () => {
    const value = occurrence({
      endsAt: "2026-03-12T15:30:00.000Z" as Occurrence["startsAt"],
    });
    expect(formatOccurrenceEnds(value)).toBe("終演 3月13日(金) 00:30");
  });
});
