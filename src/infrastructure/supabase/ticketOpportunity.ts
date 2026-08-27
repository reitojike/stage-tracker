import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';
import {
  mapTicketOpportunityMilestoneRow,
  mapTicketOpportunityRow,
  mapUserTicketOpportunityStateRow,
  sortTicketOpportunitiesByCreatedAt,
  sortTicketOpportunityMilestonesChronologically,
  type TicketOpportunityMilestone,
  type TicketOpportunityWithDetails,
  type UserTicketOpportunityState,
  type UserTicketOpportunityStatus,
} from '../../domain/ticketOpportunity.ts';
import { classifyPostgrestError, type PlanningResult } from '../../domain/planningError.ts';
import { fetchAllRows } from './pagedFetch.ts';
import { requireAuthenticatedUserId } from './planningAuth.ts';

// Typed read/write boundary over the shared TicketOpportunity schema
// (Issue #162) - this is the query boundary #144 (/tickets) and #143 (Home)
// consume so neither has to know the underlying table split (see
// domain/ticketOpportunity.ts's TicketOpportunityWithDetails).
//
// RLS split (see supabase/migrations/20260828000000_create_ticket_
// opportunities.sql and the two migrations after it):
// - ticket_opportunities / ticket_opportunity_target_occurrences /
//   ticket_opportunity_milestones are shared and SELECT-only for every
//   authenticated user - no client-facing write function exists for them in
//   this module, since the only write path is the service_role-only
//   import_ticket_opportunity RPC (Issue #163's scope to call).
// - user_ticket_opportunity_states is owner-only in both directions; the
//   write functions below (setMyTicketOpportunityState /
//   removeMyTicketOpportunityState) are this module's only mutations.

export type TicketOpportunityQueryClient = SupabaseClient<Database>;

export interface ListTicketOpportunitiesOptions {
  /** Restricts the result to Opportunities belonging to this Event. Omit to
   * read across every Event in the shared catalog. */
  eventId?: string;
}

/**
 * The shared TicketOpportunity read boundary, composed from four
 * independent table reads rather than one PostgREST embed - the same style
 * eventCatalogRead.ts uses, so a `count: 'exact'`-driven fetchAllRows
 * (pagedFetch.ts) can paginate each table to completion on its own without
 * an embed's response shape hiding a partial page. The
 * user_ticket_opportunity_states read needs no `.eq('user_id', ...)` filter:
 * user_ticket_opportunity_states_select_own already restricts it to the
 * caller's own rows, so whatever comes back *is* "my state" for each
 * opportunity id, by construction of RLS rather than by an
 * application-side filter that could drift from it.
 */
export async function listTicketOpportunitiesWithDetails(
  client: TicketOpportunityQueryClient,
  options: ListTicketOpportunitiesOptions = {},
): Promise<PlanningResult<TicketOpportunityWithDetails[]>> {
  const callerId = await requireAuthenticatedUserId(client);
  if (!callerId.ok) {
    return callerId;
  }

  const opportunitiesResult = await fetchAllRows((from, to) => {
    let query = client.from('ticket_opportunities').select('*', { count: 'exact' });
    if (options.eventId !== undefined) {
      query = query.eq('event_id', options.eventId);
    }
    return query
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
  });
  if (!opportunitiesResult.ok) {
    return opportunitiesResult;
  }
  const opportunities = sortTicketOpportunitiesByCreatedAt(
    opportunitiesResult.data.map(mapTicketOpportunityRow),
  );
  if (opportunities.length === 0) {
    return { ok: true, data: [] };
  }
  const opportunityIds = opportunities.map((opportunity) => opportunity.id);

  const [targetsResult, milestonesResult, statesResult] = await Promise.all([
    fetchAllRows((from, to) =>
      client
        .from('ticket_opportunity_target_occurrences')
        .select('opportunity_id, occurrence_id', { count: 'exact' })
        .in('opportunity_id', opportunityIds)
        .order('opportunity_id', { ascending: true })
        .order('occurrence_id', { ascending: true })
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      client
        .from('ticket_opportunity_milestones')
        .select('*', { count: 'exact' })
        .in('opportunity_id', opportunityIds)
        .order('opportunity_id', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      client
        .from('user_ticket_opportunity_states')
        .select('*', { count: 'exact' })
        .in('opportunity_id', opportunityIds)
        .order('id', { ascending: true })
        .range(from, to),
    ),
  ]);
  if (!targetsResult.ok) {
    return targetsResult;
  }
  if (!milestonesResult.ok) {
    return milestonesResult;
  }
  if (!statesResult.ok) {
    return statesResult;
  }

  const targetsByOpportunity = new Map<string, string[]>();
  for (const row of targetsResult.data) {
    const existing = targetsByOpportunity.get(row.opportunity_id) ?? [];
    existing.push(row.occurrence_id);
    targetsByOpportunity.set(row.opportunity_id, existing);
  }

  const milestonesByOpportunity = new Map<string, TicketOpportunityMilestone[]>();
  for (const row of milestonesResult.data) {
    const milestone = mapTicketOpportunityMilestoneRow(row);
    const existing = milestonesByOpportunity.get(milestone.opportunityId) ?? [];
    existing.push(milestone);
    milestonesByOpportunity.set(milestone.opportunityId, existing);
  }

  const stateByOpportunity = new Map<string, UserTicketOpportunityState>();
  for (const row of statesResult.data) {
    const state = mapUserTicketOpportunityStateRow(row);
    stateByOpportunity.set(state.opportunityId, state);
  }

  return {
    ok: true,
    data: opportunities.map((opportunity) => ({
      opportunity,
      targetOccurrenceIds: targetsByOpportunity.get(opportunity.id) ?? [],
      milestones: sortTicketOpportunityMilestonesChronologically(
        milestonesByOpportunity.get(opportunity.id) ?? [],
      ),
      myState: stateByOpportunity.get(opportunity.id) ?? null,
    })),
  };
}

/**
 * Creates or changes the caller's personal planning state for one
 * Opportunity to `status` (`planned` or `applied`) - a single upsert covers
 * every transition #162 requires ("plannedを設定", "appliedへ変更",
 * "applied -> plannedへ戻す") without the caller needing to know whether a
 * row already exists. `onConflict` names the table's own
 * unique(user_id, opportunity_id) constraint
 * (20260828000200_create_user_ticket_opportunity_states.sql), so a second
 * call for the same opportunity updates the existing row's status rather
 * than colliding.
 */
export async function setMyTicketOpportunityState(
  client: TicketOpportunityQueryClient,
  opportunityId: string,
  status: UserTicketOpportunityStatus,
): Promise<PlanningResult<UserTicketOpportunityState>> {
  const callerId = await requireAuthenticatedUserId(client);
  if (!callerId.ok) {
    return callerId;
  }

  const row: Database['public']['Tables']['user_ticket_opportunity_states']['Insert'] = {
    user_id: callerId.data,
    opportunity_id: opportunityId,
    status,
  };

  const { data, error } = await client
    .from('user_ticket_opportunity_states')
    .upsert(row, { onConflict: 'user_id,opportunity_id' })
    .select()
    .single();
  if (error !== null) {
    return { ok: false, error: classifyPostgrestError(error) };
  }
  return { ok: true, data: mapUserTicketOpportunityStateRow(data) };
}

/**
 * Removes the caller's personal planning state for one Opportunity.
 * user_ticket_opportunity_states_delete_own restricts this to the caller's
 * own row, so a delete of an id that never belonged to the caller (or never
 * existed) affects zero rows rather than erroring - reported here as
 * success with `data: undefined`, matching "rowが無い = 登録していない"
 * being the intended end state either way, not a distinguishable failure.
 */
export async function removeMyTicketOpportunityState(
  client: TicketOpportunityQueryClient,
  opportunityId: string,
): Promise<PlanningResult<void>> {
  const callerId = await requireAuthenticatedUserId(client);
  if (!callerId.ok) {
    return callerId;
  }

  const { error } = await client
    .from('user_ticket_opportunity_states')
    .delete()
    .eq('user_id', callerId.data)
    .eq('opportunity_id', opportunityId);
  if (error !== null) {
    return { ok: false, error: classifyPostgrestError(error) };
  }
  return { ok: true, data: undefined };
}
