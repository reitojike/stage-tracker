import { describe, expect, it } from "vitest";
import { ticketOpportunityMilestoneSchema } from "@stage-tracker/domain";
import { formatMilestoneWhenJa } from "./ticket-milestone-format";

const milestoneId = "33333333-3333-4333-8333-333333333333";
const opportunityId = "11111111-1111-4111-8111-111111111111";
const common = {
  id: milestoneId,
  opportunityId,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("formatMilestoneWhenJa", () => {
  it("keeps date precision without fabricating a time", () => {
    const milestone = ticketOpportunityMilestoneSchema.parse({
      ...common,
      milestoneType: "application_close",
      temporalPrecision: "date",
      dateValue: "2026-03-05",
      at: null,
      startsAt: null,
      endsAt: null,
    });
    expect(formatMilestoneWhenJa(milestone)).toBe("3月5日(木)");
  });

  it("uses the shared Tokyo datetime formatter for datetime precision", () => {
    const milestone = ticketOpportunityMilestoneSchema.parse({
      ...common,
      milestoneType: "sale_start",
      temporalPrecision: "datetime",
      dateValue: null,
      at: "2026-03-10T00:00:00.000Z",
      startsAt: null,
      endsAt: null,
    });
    expect(formatMilestoneWhenJa(milestone)).toBe("3月10日(火) 09:00");
  });

  it("preserves window precision and cross-day end output", () => {
    const milestone = ticketOpportunityMilestoneSchema.parse({
      ...common,
      milestoneType: "payment_window",
      temporalPrecision: "window",
      dateValue: null,
      at: null,
      startsAt: "2026-03-10T14:00:00.000Z",
      endsAt: "2026-03-11T02:00:00.000Z",
    });
    expect(formatMilestoneWhenJa(milestone)).toBe(
      "3月10日(火) 23:00〜3月11日(水) 11:00",
    );
  });
});
