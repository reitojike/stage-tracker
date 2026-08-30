// TicketOpportunity domain model (Issue #162, PO decision #157), over the
// persistence/RLS baseline this Task establishes
// (supabase/migrations/20260828000000_create_ticket_opportunities.sql and
// the three migrations that follow it).
//
// Product semantics (see .ai-dev-foundation/product-rules.md "Ticket
// Opportunity / Ticket Opportunity milestone / UserTicketOpportunityState"):
// - A TicketOpportunity is a shared sales/lottery opportunity against one
//   Event (宝塚友の会 第1抽選, Vpass先行, 一般発売, ...). display_name/
//   sourceKey/sourceUrl preserve the source's own vocabulary and identity
//   rather than normalizing into a closed enum.
// - targetScope names, without ambiguity, whether the Opportunity concerns
//   the whole Event ('event_wide') or an explicit subset of its Occurrences
//   ('selected_occurrences') - never a snapshot of whichever Occurrences
//   exist right now.
// - A milestone's temporalPrecision discriminates exactly the shape of
//   information the source gave: a bare date, an exact instant, or a
//   window - never a value fabricated to fill a gap the source did not
//   provide (see the milestones table's own comment for the full
//   reasoning).
// - UserTicketOpportunityState is a personal, owner-only record with
//   exactly two statuses (planned / applied); absence of a row is the only
//   representation of "not registered as a personal planning target" - it
//   is not an application record and is independent of participation.
//
// This module is pure domain logic: no Supabase/DB import (see the
// architecture import boundary in eslint.config.mjs).

import { compareByFieldThenId, sortByFieldThenId } from './ordering.ts';

export type TicketOpportunityTargetScope = 'event_wide' | 'selected_occurrences';

const TARGET_SCOPES: ReadonlySet<string> = new Set<TicketOpportunityTargetScope>([
  'event_wide',
  'selected_occurrences',
]);

function isTargetScope(value: string): value is TicketOpportunityTargetScope {
  return TARGET_SCOPES.has(value);
}

export type TicketOpportunityMilestoneType =
  | 'application_open'
  | 'application_close'
  | 'result_announcement'
  | 'sale_start'
  | 'payment_window';

const MILESTONE_TYPES: ReadonlySet<string> = new Set<TicketOpportunityMilestoneType>([
  'application_open',
  'application_close',
  'result_announcement',
  'sale_start',
  'payment_window',
]);

function isMilestoneType(value: string): value is TicketOpportunityMilestoneType {
  return MILESTONE_TYPES.has(value);
}

export type TicketOpportunityMilestoneTemporalPrecision = 'date' | 'datetime' | 'window';

const TEMPORAL_PRECISIONS: ReadonlySet<string> =
  new Set<TicketOpportunityMilestoneTemporalPrecision>(['date', 'datetime', 'window']);

function isTemporalPrecision(value: string): value is TicketOpportunityMilestoneTemporalPrecision {
  return TEMPORAL_PRECISIONS.has(value);
}

export type UserTicketOpportunityStatus = 'planned' | 'applied';

const USER_STATUSES: ReadonlySet<string> = new Set<UserTicketOpportunityStatus>([
  'planned',
  'applied',
]);

function isUserTicketOpportunityStatus(value: string): value is UserTicketOpportunityStatus {
  return USER_STATUSES.has(value);
}

export interface TicketOpportunity {
  id: string;
  eventId: string;
  targetScope: TicketOpportunityTargetScope;
  displayName: string;
  sourceKey: string;
  sourceUrl: string | null;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Matches the columns ticket_opportunity_milestones actually stores - see
 * that table's own comment for why exactly one of dateValue / at / (startsAt
 * and endsAt) is non-null, gated by temporalPrecision. */
export interface TicketOpportunityMilestone {
  id: string;
  opportunityId: string;
  milestoneType: TicketOpportunityMilestoneType;
  temporalPrecision: TicketOpportunityMilestoneTemporalPrecision;
  dateValue: string | null;
  at: string | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserTicketOpportunityState {
  id: string;
  userId: string;
  opportunityId: string;
  status: UserTicketOpportunityStatus;
  createdAt: string;
  updatedAt: string;
}

/** The read/query boundary shape downstream #144 (/tickets) and #143 (Home)
 * consume, so neither has to know the underlying table split. targetOccurrenceIds
 * is empty for an 'event_wide' opportunity by construction (see
 * ticket_opportunity_target_occurrences's own invariant) - it is not this
 * type's job to re-derive "the whole event" into an occurrence list.
 * myState is null when the caller has not registered any personal planning
 * state for this opportunity - the same "no row = not registered" reading
 * the table itself uses, not a special "unknown" value. */
export interface TicketOpportunityWithDetails {
  opportunity: TicketOpportunity;
  targetOccurrenceIds: string[];
  milestones: TicketOpportunityMilestone[];
  myState: UserTicketOpportunityState | null;
}

export interface RawTicketOpportunityRow {
  id: string;
  event_id: string;
  target_scope: string;
  display_name: string;
  source_key: string;
  source_url: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

export function mapTicketOpportunityRow(row: RawTicketOpportunityRow): TicketOpportunity {
  if (!isTargetScope(row.target_scope)) {
    throw new Error(
      `ticket opportunity ${row.id} has an unrecognized target_scope: ${row.target_scope}`,
    );
  }
  return {
    id: row.id,
    eventId: row.event_id,
    targetScope: row.target_scope,
    displayName: row.display_name,
    sourceKey: row.source_key,
    sourceUrl: row.source_url,
    memo: row.memo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface RawTicketOpportunityMilestoneRow {
  id: string;
  opportunity_id: string;
  milestone_type: string;
  temporal_precision: string;
  date_value: string | null;
  at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export function mapTicketOpportunityMilestoneRow(
  row: RawTicketOpportunityMilestoneRow,
): TicketOpportunityMilestone {
  if (!isMilestoneType(row.milestone_type)) {
    throw new Error(
      `ticket opportunity milestone ${row.id} has an unrecognized milestone_type: ${row.milestone_type}`,
    );
  }
  if (!isTemporalPrecision(row.temporal_precision)) {
    throw new Error(
      `ticket opportunity milestone ${row.id} has an unrecognized temporal_precision: ${row.temporal_precision}`,
    );
  }
  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    milestoneType: row.milestone_type,
    temporalPrecision: row.temporal_precision,
    dateValue: row.date_value,
    at: row.at,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface RawUserTicketOpportunityStateRow {
  id: string;
  user_id: string;
  opportunity_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export function mapUserTicketOpportunityStateRow(
  row: RawUserTicketOpportunityStateRow,
): UserTicketOpportunityState {
  if (!isUserTicketOpportunityStatus(row.status)) {
    throw new Error(
      `user ticket opportunity state ${row.id} has an unrecognized status: ${row.status}`,
    );
  }
  return {
    id: row.id,
    userId: row.user_id,
    opportunityId: row.opportunity_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The instant a milestone sorts by, derived only for ordering purposes -
 * never persisted, and never presented as a claim of higher precision than
 * the milestone actually carries. A 'date' milestone sorts as that date's
 * start-of-day UTC instant; this can interleave slightly differently than a
 * same-day 'datetime'/'window' milestone would under a fully precise
 * comparison, which is accepted here as an ordering-only approximation, not
 * a display value.
 */
export function ticketOpportunityMilestoneSortInstant(
  milestone: TicketOpportunityMilestone,
): string {
  if (milestone.at !== null) {
    return milestone.at;
  }
  if (milestone.startsAt !== null) {
    return milestone.startsAt;
  }
  if (milestone.dateValue !== null) {
    return `${milestone.dateValue}T00:00:00.000Z`;
  }
  throw new Error(`ticket opportunity milestone ${milestone.id} has no temporal value to sort by`);
}

/** Deterministic ordering: sort instant ascending, id as a stable
 * tie-breaker - see domain/ordering.ts. */
export function compareTicketOpportunityMilestonesChronologically(
  a: TicketOpportunityMilestone,
  b: TicketOpportunityMilestone,
): number {
  return compareByFieldThenId(a, b, ticketOpportunityMilestoneSortInstant);
}

export function sortTicketOpportunityMilestonesChronologically(
  milestones: readonly TicketOpportunityMilestone[],
): TicketOpportunityMilestone[] {
  return sortByFieldThenId(milestones, ticketOpportunityMilestoneSortInstant);
}

/** Deterministic ordering for a list of opportunities themselves: created_at
 * ascending, id as a stable tie-breaker - matching every other feature-level
 * list in this codebase (e.g. domain/eventCatalog.ts). */
export function compareTicketOpportunitiesByCreatedAt(
  a: TicketOpportunity,
  b: TicketOpportunity,
): number {
  return compareByFieldThenId(a, b, (opportunity) => opportunity.createdAt);
}

export function sortTicketOpportunitiesByCreatedAt(
  opportunities: readonly TicketOpportunity[],
): TicketOpportunity[] {
  return sortByFieldThenId(opportunities, (opportunity) => opportunity.createdAt);
}
