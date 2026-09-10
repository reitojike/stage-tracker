import { describe, expect, it } from "vitest";
import type { TokyoCalendarDate } from "@stage-tracker/domain";
import {
  layoutWeekBands,
  MAX_BAND_LANES,
  type BandSegment,
} from "./calendar-band-layout";

function date(value: string): TokyoCalendarDate {
  return value as TokyoCalendarDate;
}

// A Sunday..Saturday week (7 dates), matching buildMonthGridDays' own
// Sunday-start convention.
const WEEK: readonly TokyoCalendarDate[] = [
  date("2026-03-01"),
  date("2026-03-02"),
  date("2026-03-03"),
  date("2026-03-04"),
  date("2026-03-05"),
  date("2026-03-06"),
  date("2026-03-07"),
];

function segment(
  overrides: Partial<BandSegment> & { eventId: string },
): BandSegment {
  return {
    eventTitle: overrides.eventId,
    startDate: date("2026-03-01"),
    endDate: date("2026-03-01"),
    isCanceled: false,
    ...overrides,
  };
}

describe("layoutWeekBands", () => {
  it("throws when not given exactly 7 dates", () => {
    expect(() => layoutWeekBands(WEEK.slice(0, 3), [])).toThrow();
  });

  it("places a single segment in lane 0, spanning its full column range", () => {
    const result = layoutWeekBands(WEEK, [
      segment({
        eventId: "a",
        startDate: date("2026-03-02"),
        endDate: date("2026-03-04"),
      }),
    ]);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({
      lane: 0,
      startCol: 1,
      endCol: 3,
    });
    expect(result.overflowCount).toBe(0);
  });

  it("clips a segment to the week's own date range at a week boundary", () => {
    const result = layoutWeekBands(WEEK, [
      // Starts before the week, ends after it - the whole week should be
      // covered (col 0..6), not the segment's own unclipped range.
      segment({
        eventId: "a",
        startDate: date("2026-02-25"),
        endDate: date("2026-03-20"),
      }),
    ]);
    expect(result.segments[0]).toMatchObject({ startCol: 0, endCol: 6 });
  });

  it("assigns non-overlapping segments to the same lane", () => {
    const result = layoutWeekBands(WEEK, [
      segment({
        eventId: "a",
        startDate: date("2026-03-01"),
        endDate: date("2026-03-02"),
      }),
      segment({
        eventId: "b",
        startDate: date("2026-03-03"),
        endDate: date("2026-03-04"),
      }),
    ]);
    expect(result.segments.map((s) => s.lane)).toEqual([0, 0]);
    expect(result.overflowCount).toBe(0);
  });

  it("assigns overlapping segments to different lanes, up to MAX_BAND_LANES", () => {
    const result = layoutWeekBands(WEEK, [
      segment({
        eventId: "a",
        startDate: date("2026-03-01"),
        endDate: date("2026-03-05"),
      }),
      segment({
        eventId: "b",
        startDate: date("2026-03-02"),
        endDate: date("2026-03-06"),
      }),
    ]);
    expect(result.segments).toHaveLength(2);
    expect(new Set(result.segments.map((s) => s.lane))).toEqual(
      new Set([0, 1]),
    );
    expect(result.overflowCount).toBe(0);
  });

  it("pushes a 3rd concurrent segment to overflow rather than a 3rd lane", () => {
    expect(MAX_BAND_LANES).toBe(2);
    const result = layoutWeekBands(WEEK, [
      segment({
        eventId: "a",
        startDate: date("2026-03-01"),
        endDate: date("2026-03-07"),
      }),
      segment({
        eventId: "b",
        startDate: date("2026-03-01"),
        endDate: date("2026-03-07"),
      }),
      segment({
        eventId: "c",
        startDate: date("2026-03-01"),
        endDate: date("2026-03-07"),
      }),
    ]);
    expect(result.segments).toHaveLength(2);
    expect(result.overflowCount).toBe(1);
    expect(result.overflowEvents.map((e) => e.eventId)).toEqual(["c"]);
  });

  it("sorts by start column, then by longer segment first on a tie", () => {
    const result = layoutWeekBands(WEEK, [
      segment({
        eventId: "short",
        startDate: date("2026-03-02"),
        endDate: date("2026-03-02"),
      }),
      segment({
        eventId: "long",
        startDate: date("2026-03-02"),
        endDate: date("2026-03-06"),
      }),
    ]);
    // Both start at col 1; the longer one is laid out first (lane 0).
    const long = result.segments.find((s) => s.eventId === "long");
    const short = result.segments.find((s) => s.eventId === "short");
    expect(long?.lane).toBe(0);
    expect(short?.lane).toBe(1);
  });

  it("de-duplicates overflowEvents by eventId even if a caller passed duplicate segments", () => {
    const dup = segment({
      eventId: "dup",
      startDate: date("2026-03-01"),
      endDate: date("2026-03-07"),
    });
    const result = layoutWeekBands(WEEK, [
      segment({
        eventId: "a",
        startDate: date("2026-03-01"),
        endDate: date("2026-03-07"),
      }),
      segment({
        eventId: "b",
        startDate: date("2026-03-01"),
        endDate: date("2026-03-07"),
      }),
      dup,
      dup,
    ]);
    expect(result.overflowEvents).toHaveLength(1);
  });

  it("excludes a segment entirely outside the week", () => {
    const result = layoutWeekBands(WEEK, [
      segment({
        eventId: "a",
        startDate: date("2026-04-01"),
        endDate: date("2026-04-05"),
      }),
    ]);
    expect(result.segments).toHaveLength(0);
    expect(result.overflowCount).toBe(0);
  });
});
