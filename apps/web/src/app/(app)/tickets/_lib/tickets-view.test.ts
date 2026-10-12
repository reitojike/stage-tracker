import { describe, expect, it } from "vitest";
import {
  eventIdSchema,
  instantSchema,
  ticketOpportunityIdSchema,
  ticketOpportunityMilestoneIdSchema,
  ticketOpportunityMilestoneSchema,
} from "@stage-tracker/domain";
import type {
  TicketsTimelineMonthGroup,
  TicketsTimelineRow,
} from "./tickets-loader";
import { filterTicketsTimelineGroups, parseTicketsView } from "./tickets-view";

function row(
  myState: "planned" | "applied" | null,
  isPast: boolean,
): TicketsTimelineRow {
  const opportunityId = ticketOpportunityIdSchema.parse(
    "44444444-4444-4444-8444-444444444444",
  );
  return {
    opportunityId,
    eventId: eventIdSchema.parse("22222222-2222-4222-8222-222222222222"),
    displayName: "テスト受付",
    milestone: ticketOpportunityMilestoneSchema.parse({
      id: ticketOpportunityMilestoneIdSchema.parse(
        isPast
          ? "99999999-9999-4999-8999-999999999999"
          : "55555555-5555-4555-8555-555555555555",
      ),
      opportunityId,
      milestoneType: "sale_start",
      temporalPrecision: "datetime",
      at: instantSchema.parse("2026-03-10T10:00:00.000Z"),
      createdAt: instantSchema.parse("2026-01-01T00:00:00.000Z"),
      updatedAt: instantSchema.parse("2026-01-01T00:00:00.000Z"),
    }),
    sortInstant: instantSchema.parse("2026-03-10T10:00:00.000Z"),
    myState,
    isFirstRowForOpportunity: true,
    isPostFinalRetainedHistory: isPast,
    isEffectivelyCanceled: false,
    eventTitle: "テスト公演",
    eventVenue: null,
    targetScope: "event_wide",
    targetOccurrences: [],
    sourceUrl: null,
  };
}

describe("parseTicketsView", () => {
  it.each([
    [undefined, "upcoming"],
    ["unknown", "upcoming"],
    ["planned", "planned"],
  ] as const)("resolves %s", (value, expected) => {
    expect(parseTicketsView(value)).toBe(expected);
  });

  it("uses the first value when view is repeated", () => {
    expect(parseTicketsView(["applied", "past"])).toBe("applied");
  });
});

describe("filterTicketsTimelineGroups", () => {
  const groups: TicketsTimelineMonthGroup[] = [
    {
      monthKey: "2026-03",
      rows: [row("planned", false), row("applied", false), row(null, false)],
    },
    {
      monthKey: "2026-02",
      rows: [row("planned", true)],
    },
  ];

  it("keeps all current rows under upcoming and only the bounded retained set under past", () => {
    expect(
      filterTicketsTimelineGroups(groups, "upcoming").map(
        (group) => group.rows,
      ),
    ).toEqual([groups[0]?.rows]);
    expect(
      filterTicketsTimelineGroups(groups, "past").map((group) => group.rows),
    ).toEqual([groups[1]?.rows]);
  });

  it("filters self-planned/applied rows without including retained history", () => {
    expect(
      filterTicketsTimelineGroups(groups, "planned").map((group) => group.rows),
    ).toEqual([[groups[0]?.rows[0]]]);
    expect(
      filterTicketsTimelineGroups(groups, "applied").map((group) => group.rows),
    ).toEqual([[groups[0]?.rows[1]]]);
  });

  it("returns no month headings for an empty filtered list", () => {
    expect(filterTicketsTimelineGroups([], "upcoming")).toEqual([]);
  });
});
