import { describe, expect, it } from "vitest";
import {
  instantSchema,
  occurrenceSchema,
  ticketOpportunityIdSchema,
  ticketOpportunityMilestoneIdSchema,
  ticketOpportunityMilestoneSchema,
  tokyoCalendarDateSchema,
} from "@stage-tracker/domain";
import {
  ticketDeadlineBadgeDisplay,
  ticketPersonalStateBadgeDisplay,
  ticketTargetScopeLabel,
} from "./ticket-display";

const NOW = instantSchema.parse("2026-01-01T00:00:00Z");
const OPPORTUNITY_ID = ticketOpportunityIdSchema.parse(
  "11111111-1111-4111-8111-111111111111",
);
const MILESTONE_ID = ticketOpportunityMilestoneIdSchema.parse(
  "22222222-2222-4222-8222-222222222222",
);
const TODAY = tokyoCalendarDateSchema.parse("2026-03-10");

function deadline(dateValue: string) {
  return ticketOpportunityMilestoneSchema.parse({
    id: MILESTONE_ID,
    opportunityId: OPPORTUNITY_ID,
    milestoneType: "application_close",
    temporalPrecision: "date",
    dateValue,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function row(dateValue: string) {
  return {
    milestone: deadline(dateValue),
    myState: "planned" as const,
    isPostFinalRetainedHistory: false,
    isEffectivelyCanceled: false,
  };
}

describe("ticketDeadlineBadgeDisplay", () => {
  it("distinguishes today, urgent, and later in-window deadlines", () => {
    expect(ticketDeadlineBadgeDisplay(row("2026-03-10"), TODAY)).toEqual({
      variant: "deadline",
      label: "本日締切",
    });
    expect(ticketDeadlineBadgeDisplay(row("2026-03-13"), TODAY)).toEqual({
      variant: "deadline",
      label: "残り3日",
    });
    expect(ticketDeadlineBadgeDisplay(row("2026-03-14"), TODAY)).toEqual({
      variant: "outline",
      label: "残り4日",
    });
  });

  it("does not imply urgency outside the planned active deadline case", () => {
    expect(
      ticketDeadlineBadgeDisplay(
        { ...row("2026-03-11"), myState: "applied" },
        TODAY,
      ),
    ).toBeNull();
    expect(
      ticketDeadlineBadgeDisplay(
        { ...row("2026-03-11"), isEffectivelyCanceled: true },
        TODAY,
      ),
    ).toBeNull();
    expect(ticketDeadlineBadgeDisplay(row("2026-03-24"), TODAY)).toBeNull();
  });
});

describe("ticketPersonalStateBadgeDisplay", () => {
  it("keeps Home and Tickets personal-state labels on one mapping", () => {
    expect(ticketPersonalStateBadgeDisplay(null, true)).toEqual({
      variant: "outline",
      label: "不明",
    });
    expect(ticketPersonalStateBadgeDisplay("planned", false)).toEqual({
      variant: "subtle",
      label: "申し込む予定",
    });
    expect(ticketPersonalStateBadgeDisplay("applied", false)).toEqual({
      variant: "done",
      label: "申し込み済み",
    });
    expect(ticketPersonalStateBadgeDisplay(null, false)).toBeNull();
  });
});

describe("ticketTargetScopeLabel", () => {
  it("keeps event-wide and selected occurrence scopes distinct", () => {
    const occurrence = occurrenceSchema.parse({
      id: "33333333-3333-4333-8333-333333333333",
      eventId: "44444444-4444-4444-8444-444444444444",
      doorsAt: null,
      startsAt: "2026-03-15T10:00:00Z",
      endsAt: "2026-03-15T12:00:00Z",
      canceledAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });

    expect(ticketTargetScopeLabel("event_wide", [])).toBe("公演全体");
    expect(
      ticketTargetScopeLabel("selected_occurrences", [occurrence]),
    ).toContain("対象公演回: 3月15日(日) 19:00〜21:00");
  });
});
