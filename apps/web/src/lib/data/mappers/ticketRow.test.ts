import { describe, expect, it } from "vitest";
import {
  mapTicketOpportunityMilestoneRow,
  mapTicketOpportunityRow,
  mapUserTicketOpportunityStateRow,
  type TicketOpportunityMilestoneRow,
  type TicketOpportunityRow,
  type UserTicketOpportunityStateRow,
} from "./ticketRow";

const opportunityId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";

function baseOpportunityRow(
  overrides: Partial<TicketOpportunityRow> = {},
): TicketOpportunityRow {
  return {
    id: opportunityId,
    event_id: eventId,
    target_scope: "event_wide",
    display_name: "FC先行",
    source_key: "fc-presale-1",
    source_url: null,
    memo: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function baseMilestoneRow(
  overrides: Partial<TicketOpportunityMilestoneRow> = {},
): TicketOpportunityMilestoneRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    opportunity_id: opportunityId,
    milestone_type: "application_close",
    temporal_precision: "date",
    date_value: "2026-02-01",
    at: null,
    starts_at: null,
    ends_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("mapTicketOpportunityRow", () => {
  it("preserves the source display name verbatim (no closed-enum normalization)", () => {
    const result = mapTicketOpportunityRow(
      baseOpportunityRow({ display_name: "宝塚友の会 第1抽選" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.displayName).toBe("宝塚友の会 第1抽選");
    }
  });

  it("returns an error (never throws) for an out-of-vocabulary target_scope", () => {
    const result = mapTicketOpportunityRow(
      baseOpportunityRow({ target_scope: "everyone" }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("mapTicketOpportunityMilestoneRow", () => {
  it("maps a date-precision milestone without fabricating a time", () => {
    const result = mapTicketOpportunityMilestoneRow(baseMilestoneRow());
    expect(result.ok).toBe(true);
    if (result.ok && result.value.temporalPrecision === "date") {
      expect(result.value.dateValue).toBe("2026-02-01");
    }
  });

  it("maps a datetime-precision milestone", () => {
    const result = mapTicketOpportunityMilestoneRow(
      baseMilestoneRow({
        milestone_type: "sale_start",
        temporal_precision: "datetime",
        date_value: null,
        at: "2026-02-01T10:00:00Z",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.value.temporalPrecision === "datetime") {
      expect(result.value.at).toBe("2026-02-01T10:00:00.000Z");
    }
  });

  it("maps a window-precision milestone", () => {
    const result = mapTicketOpportunityMilestoneRow(
      baseMilestoneRow({
        milestone_type: "payment_window",
        temporal_precision: "window",
        date_value: null,
        starts_at: "2026-02-01T00:00:00Z",
        ends_at: "2026-02-10T00:00:00Z",
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("returns an error (never throws) when the precision-specific field is missing", () => {
    const result = mapTicketOpportunityMilestoneRow(
      baseMilestoneRow({ temporal_precision: "date", date_value: null }),
    );
    expect(result.ok).toBe(false);
  });

  it("returns an error (never throws) for an unknown temporal_precision", () => {
    const result = mapTicketOpportunityMilestoneRow(
      baseMilestoneRow({ temporal_precision: "unknown" }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("mapUserTicketOpportunityStateRow", () => {
  function baseStateRow(
    overrides: Partial<UserTicketOpportunityStateRow> = {},
  ): UserTicketOpportunityStateRow {
    return {
      id: "44444444-4444-4444-8444-444444444444",
      user_id: "55555555-5555-4555-8555-555555555555",
      opportunity_id: opportunityId,
      status: "planned",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...overrides,
    };
  }

  it("maps a well-formed planned state", () => {
    const result = mapUserTicketOpportunityStateRow(baseStateRow());
    expect(result.ok).toBe(true);
  });

  it("returns an error (never throws) for an out-of-vocabulary status", () => {
    const result = mapUserTicketOpportunityStateRow(
      baseStateRow({ status: "applied_twice" }),
    );
    expect(result.ok).toBe(false);
  });
});
