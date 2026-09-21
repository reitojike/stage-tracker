import {
  err,
  ok,
  ticketOpportunityMilestoneSchema,
  ticketOpportunitySchema,
  userTicketOpportunityStateSchema,
  type Result,
  type TicketOpportunity,
  type TicketOpportunityMilestone,
  type UserTicketOpportunityState,
} from "@stage-tracker/domain";
import { invalidRowSchemaError } from "../row-mapping";

/** Raw `ticket_opportunities` row shape, validated by this mapper. */
export interface TicketOpportunityRow {
  readonly id: string;
  readonly event_id: string;
  readonly target_scope: string;
  readonly display_name: string;
  readonly source_key: string;
  readonly source_url: string | null;
  readonly memo: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export function mapTicketOpportunityRow(
  row: TicketOpportunityRow,
): Result<TicketOpportunity, string> {
  const parsed = ticketOpportunitySchema.safeParse({
    id: row.id,
    eventId: row.event_id,
    targetScope: row.target_scope,
    displayName: row.display_name,
    sourceKey: row.source_key,
    sourceUrl: row.source_url,
    memo: row.memo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  if (!parsed.success) {
    return err(
      invalidRowSchemaError("ticket_opportunities", row.id, parsed.error),
    );
  }
  return ok(parsed.data);
}

/** Raw `ticket_opportunity_milestones` row shape, validated by this mapper. */
export interface TicketOpportunityMilestoneRow {
  readonly id: string;
  readonly opportunity_id: string;
  readonly milestone_type: string;
  readonly temporal_precision: string;
  readonly date_value: string | null;
  readonly at: string | null;
  readonly starts_at: string | null;
  readonly ends_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export function mapTicketOpportunityMilestoneRow(
  row: TicketOpportunityMilestoneRow,
): Result<TicketOpportunityMilestone, string> {
  const common = {
    id: row.id,
    opportunityId: row.opportunity_id,
    milestoneType: row.milestone_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  let candidate: Record<string, unknown>;
  switch (row.temporal_precision) {
    case "date": {
      if (row.date_value === null) {
        return err(
          `Invalid ticket_opportunity_milestones row (id=${row.id}): temporal_precision=date but date_value missing.`,
        );
      }
      candidate = {
        ...common,
        temporalPrecision: "date",
        dateValue: row.date_value,
      };
      break;
    }
    case "datetime": {
      if (row.at === null) {
        return err(
          `Invalid ticket_opportunity_milestones row (id=${row.id}): temporal_precision=datetime but at missing.`,
        );
      }
      candidate = { ...common, temporalPrecision: "datetime", at: row.at };
      break;
    }
    case "window": {
      if (row.starts_at === null || row.ends_at === null) {
        return err(
          `Invalid ticket_opportunity_milestones row (id=${row.id}): temporal_precision=window but starts_at/ends_at missing.`,
        );
      }
      candidate = {
        ...common,
        temporalPrecision: "window",
        startsAt: row.starts_at,
        endsAt: row.ends_at,
      };
      break;
    }
    default:
      return err(
        `Invalid ticket_opportunity_milestones row (id=${row.id}): unknown temporal_precision "${row.temporal_precision}".`,
      );
  }

  const parsed = ticketOpportunityMilestoneSchema.safeParse(candidate);
  if (!parsed.success) {
    return err(
      invalidRowSchemaError(
        "ticket_opportunity_milestones",
        row.id,
        parsed.error,
      ),
    );
  }
  return ok(parsed.data);
}

/** Raw `user_ticket_opportunity_states` row shape, validated by this mapper. */
export interface UserTicketOpportunityStateRow {
  readonly id: string;
  readonly user_id: string;
  readonly opportunity_id: string;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export function mapUserTicketOpportunityStateRow(
  row: UserTicketOpportunityStateRow,
): Result<UserTicketOpportunityState, string> {
  const parsed = userTicketOpportunityStateSchema.safeParse({
    id: row.id,
    userId: row.user_id,
    opportunityId: row.opportunity_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  if (!parsed.success) {
    return err(
      invalidRowSchemaError(
        "user_ticket_opportunity_states",
        row.id,
        parsed.error,
      ),
    );
  }
  return ok(parsed.data);
}
