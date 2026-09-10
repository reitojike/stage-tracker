import { describe, expect, it } from "vitest";
import type { EventCatalogEntry } from "@/lib/data";
import {
  buildCatalogMonthViewModel,
  computeBadgeCounts,
  eventRangeBandSegment,
  isSingleDayEvent,
  selectDayOccurrences,
  selectEventLevelFallback,
} from "./calendar-view-model";

function entry(
  overrides: Partial<{
    id: string;
    title: string;
    startsOn: string;
    endsOn: string;
    canceledAt: string | null;
    occurrences: readonly { id: string; startsAt: string }[];
  }> = {},
): EventCatalogEntry {
  const {
    id = "22222222-2222-4222-8222-222222222222",
    title = "テスト公演",
    startsOn = "2026-03-01",
    endsOn = "2026-03-01",
    canceledAt = null,
    occurrences = [],
  } = overrides;
  return {
    event: {
      id,
      ownerId: "11111111-1111-4111-8111-111111111111",
      title,
      venue: null,
      sourceUrl: null,
      memo: null,
      startsOn,
      endsOn,
      canceledAt,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as never,
    occurrences: occurrences.map((occurrence) => ({
      id: occurrence.id,
      eventId: id,
      doorsAt: null,
      startsAt: occurrence.startsAt,
      endsAt: null,
      canceledAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })) as never,
    classification: {
      eventId: id as never,
      genre: null,
      groupIds: [],
    },
  };
}

describe("isSingleDayEvent", () => {
  it("is true when startsOn === endsOn", () => {
    expect(
      isSingleDayEvent(
        entry({ startsOn: "2026-03-01", endsOn: "2026-03-01" }).event,
      ),
    ).toBe(true);
  });

  it("is false for a multi-day range", () => {
    expect(
      isSingleDayEvent(
        entry({ startsOn: "2026-03-01", endsOn: "2026-03-05" }).event,
      ),
    ).toBe(false);
  });
});

describe("computeBadgeCounts", () => {
  it("counts single-day Events per date, once each regardless of occurrence count", () => {
    const entries = [
      entry({ id: "a", startsOn: "2026-03-05", endsOn: "2026-03-05" }),
      entry({
        id: "b",
        startsOn: "2026-03-05",
        endsOn: "2026-03-05",
        occurrences: [
          { id: "o1", startsAt: "2026-03-05T01:00:00.000Z" },
          { id: "o2", startsAt: "2026-03-05T10:00:00.000Z" },
        ],
      }),
    ];
    const counts = computeBadgeCounts(entries);
    expect(counts.get("2026-03-05" as never)).toBe(2);
  });

  it("never counts a multi-day Event", () => {
    const entries = [entry({ startsOn: "2026-03-01", endsOn: "2026-03-05" })];
    expect(computeBadgeCounts(entries).size).toBe(0);
  });
});

describe("eventRangeBandSegment", () => {
  it("spans the Event's own range and carries cancellation", () => {
    const { event } = entry({
      id: "c1",
      title: "中止公演",
      startsOn: "2026-03-01",
      endsOn: "2026-03-10",
      canceledAt: "2026-02-01T00:00:00.000Z",
    });
    const segment = eventRangeBandSegment(event);
    expect(segment).toMatchObject({
      eventId: "c1",
      eventTitle: "中止公演",
      startDate: "2026-03-01",
      endDate: "2026-03-10",
      isCanceled: true,
    });
  });
});

describe("buildCatalogMonthViewModel", () => {
  it("builds a grid whose weeks are all 7-day multiples and marks in-month cells", () => {
    const viewModel = buildCatalogMonthViewModel({ year: 2026, month: 3 }, []);
    for (const week of viewModel.weeks) {
      expect(week.days).toHaveLength(7);
    }
    const inMonthCount = viewModel.weeks
      .flatMap((week) => week.days)
      .filter((day) => day.inCurrentMonth).length;
    expect(inMonthCount).toBe(31); // March has 31 days
  });

  it("places a single-day Event's count on its own day, and a multi-day Event as a band", () => {
    const entries = [
      entry({ id: "single", startsOn: "2026-03-05", endsOn: "2026-03-05" }),
      entry({ id: "multi", startsOn: "2026-03-10", endsOn: "2026-03-12" }),
    ];
    const viewModel = buildCatalogMonthViewModel(
      { year: 2026, month: 3 },
      entries,
    );
    const allDays = viewModel.weeks.flatMap((week) => week.days);
    const singleDay = allDays.find((day) => day.date === "2026-03-05");
    expect(singleDay?.badgeCount).toBe(1);

    const bandSegments = viewModel.weeks.flatMap(
      (week) => week.bandLayout.segments,
    );
    expect(bandSegments.some((segment) => segment.eventId === "multi")).toBe(
      true,
    );
    // The multi-day event must never also contribute to a badgeCount.
    const multiDayCells = allDays.filter(
      (day) => day.date >= "2026-03-10" && day.date <= "2026-03-12",
    );
    expect(multiDayCells.every((day) => day.badgeCount === 0)).toBe(true);
  });

  it("reports hasUnconfirmedHolidayCoverage for a month beyond the holiday snapshot's coverage", () => {
    const farFuture = buildCatalogMonthViewModel({ year: 2030, month: 1 }, []);
    expect(farFuture.hasUnconfirmedHolidayCoverage).toBe(true);

    const withinCoverage = buildCatalogMonthViewModel(
      { year: 2026, month: 3 },
      [],
    );
    expect(withinCoverage.hasUnconfirmedHolidayCoverage).toBe(false);
  });

  it("assigns a day-role to every day, independent of event data", () => {
    const viewModel = buildCatalogMonthViewModel({ year: 2026, month: 3 }, []);
    const allDays = viewModel.weeks.flatMap((week) => week.days);
    const jan1 = allDays.find((day) => day.date === "2026-03-01");
    // 2026-03-01 is a Sunday.
    expect(jan1?.role).toBe("sunday");
  });
});

describe("selectDayOccurrences", () => {
  it("returns only occurrences whose Tokyo calendar date matches, sorted by startsAt", () => {
    const entries = [
      entry({
        id: "a",
        occurrences: [
          { id: "late", startsAt: "2026-03-05T10:00:00.000Z" },
          { id: "early", startsAt: "2026-03-05T01:00:00.000Z" },
          { id: "other-day", startsAt: "2026-03-06T01:00:00.000Z" },
        ],
      }),
    ];
    const result = selectDayOccurrences(entries, "2026-03-05" as never);
    expect(result.map((r) => r.occurrence.id)).toEqual(["early", "late"]);
  });

  it("returns an empty array when nothing occurs on that date", () => {
    const entries = [entry({ occurrences: [] })];
    expect(selectDayOccurrences(entries, "2026-03-05" as never)).toEqual([]);
  });
});

describe("selectEventLevelFallback", () => {
  it("includes an Event whose range covers the date but has no occurrence on it", () => {
    const entries = [
      entry({
        id: "a",
        startsOn: "2026-03-01",
        endsOn: "2026-03-10",
        occurrences: [],
      }),
    ];
    const result = selectEventLevelFallback(entries, "2026-03-05" as never);
    expect(result.map((r) => r.event.id)).toEqual(["a"]);
  });

  it("excludes an Event that has an actual occurrence on the date (selectDayOccurrences' complement)", () => {
    const entries = [
      entry({
        id: "a",
        startsOn: "2026-03-01",
        endsOn: "2026-03-10",
        occurrences: [{ id: "o1", startsAt: "2026-03-05T01:00:00.000Z" }],
      }),
    ];
    expect(selectEventLevelFallback(entries, "2026-03-05" as never)).toEqual(
      [],
    );
  });

  it("excludes an Event whose range does not cover the date", () => {
    const entries = [
      entry({
        id: "a",
        startsOn: "2026-04-01",
        endsOn: "2026-04-10",
        occurrences: [],
      }),
    ];
    expect(selectEventLevelFallback(entries, "2026-03-05" as never)).toEqual(
      [],
    );
  });
});
