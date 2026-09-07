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

/**
 * `.in('opportunity_id', opportunityIds)` embeds the id list directly in the
 * request URL; an unbounded list risks exceeding practical URL/query length
 * limits, the same hazard eventCatalogRead.ts's ID_BATCH_SIZE exists to
 * bound (see its own comment). Chunking keeps each of the three per-table
 * requests below bounded independently of how many Opportunities a given
 * read touches.
 */
const ID_BATCH_SIZE = 200;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

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
  const idBatches = chunk(opportunityIds, ID_BATCH_SIZE);

  const [targetBatches, milestoneBatches, stateBatches] = await Promise.all([
    Promise.all(
      idBatches.map((idBatch) =>
        fetchAllRows((from, to) =>
          client
            .from('ticket_opportunity_target_occurrences')
            .select('opportunity_id, occurrence_id', { count: 'exact' })
            .in('opportunity_id', idBatch)
            .order('opportunity_id', { ascending: true })
            .order('occurrence_id', { ascending: true })
            .range(from, to),
        ),
      ),
    ),
    Promise.all(
      idBatches.map((idBatch) =>
        fetchAllRows((from, to) =>
          client
            .from('ticket_opportunity_milestones')
            .select('*', { count: 'exact' })
            .in('opportunity_id', idBatch)
            .order('opportunity_id', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to),
        ),
      ),
    ),
    Promise.all(
      idBatches.map((idBatch) =>
        fetchAllRows((from, to) =>
          client
            .from('user_ticket_opportunity_states')
            .select('*', { count: 'exact' })
            .in('opportunity_id', idBatch)
            .order('id', { ascending: true })
            .range(from, to),
        ),
      ),
    ),
  ]);

  const targetsByOpportunity = new Map<string, string[]>();
  for (const batchResult of targetBatches) {
    if (!batchResult.ok) {
      return batchResult;
    }
    for (const row of batchResult.data) {
      const existing = targetsByOpportunity.get(row.opportunity_id) ?? [];
      existing.push(row.occurrence_id);
      targetsByOpportunity.set(row.opportunity_id, existing);
    }
  }

  const milestonesByOpportunity = new Map<string, TicketOpportunityMilestone[]>();
  for (const batchResult of milestoneBatches) {
    if (!batchResult.ok) {
      return batchResult;
    }
    for (const row of batchResult.data) {
      const milestone = mapTicketOpportunityMilestoneRow(row);
      const existing = milestonesByOpportunity.get(milestone.opportunityId) ?? [];
      existing.push(milestone);
      milestonesByOpportunity.set(milestone.opportunityId, existing);
    }
  }

  const stateByOpportunity = new Map<string, UserTicketOpportunityState>();
  for (const batchResult of stateBatches) {
    if (!batchResult.ok) {
      return batchResult;
    }
    for (const row of batchResult.data) {
      const state = mapUserTicketOpportunityStateRow(row);
      stateByOpportunity.set(state.opportunityId, state);
    }
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
 * row already exists.
 *
 * Not a single `.upsert()`: PostgREST's ON CONFLICT DO UPDATE always sets
 * *every* column in the submitted payload, including user_id and
 * opportunity_id - which carry no UPDATE grant
 * (user_ticket_opportunity_states_insert_own/_update_own are INSERT-only for
 * those columns, see 20260828000200_create_user_ticket_opportunity_states.sql).
 * A real upsert against this table therefore always fails with 42501 on the
 * conflict path, regardless of whether a row exists yet - the same hazard
 * participation.ts's setParticipation documents and works around for
 * occurrence_participations, which has the identical grant shape. Updating
 * first, and inserting only when that affects no row, keeps every write
 * within its actual grant.
 *
 * The gap between "update matched nothing" and the insert below is a real
 * race window: a concurrent call for the same (user, opportunity) can land
 * its insert first, which surfaces here as a unique_violation on
 * user_ticket_opportunity_states's own unique(user_id, opportunity_id). That
 * is recovered by retrying the update once, onto the row the other call just
 * created, rather than surfacing a spurious conflict for an operation that is
 * conceptually just "set my own state".
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
  const callerUserId = callerId.data;

  async function tryUpdate(): Promise<PlanningResult<UserTicketOpportunityState> | null> {
    const { data, error } = await client
      .from('user_ticket_opportunity_states')
      .update({ status })
      .eq('user_id', callerUserId)
      .eq('opportunity_id', opportunityId)
      .select()
      .maybeSingle();
    if (error !== null) {
      return { ok: false, error: classifyPostgrestError(error) };
    }
    return data === null ? null : { ok: true, data: mapUserTicketOpportunityStateRow(data) };
  }

  const updated = await tryUpdate();
  if (updated !== null) {
    return updated;
  }

  const insertRow: Database['public']['Tables']['user_ticket_opportunity_states']['Insert'] = {
    user_id: callerUserId,
    opportunity_id: opportunityId,
    status,
  };
  const { data, error } = await client
    .from('user_ticket_opportunity_states')
    .insert(insertRow)
    .select()
    .single();
  if (error === null) {
    return { ok: true, data: mapUserTicketOpportunityStateRow(data) };
  }
  if (error.code !== '23505') {
    return { ok: false, error: classifyPostgrestError(error) };
  }

  // Lost the race: someone else's insert landed first. Their row now
  // exists, so the update this caller actually asked for can proceed.
  const retried = await tryUpdate();
  if (retried !== null) {
    return retried;
  }
  return {
    ok: false,
    error: {
      kind: 'failure',
      message: 'ticket opportunity state could not be set after a concurrent write',
      code: 'concurrent-write-unresolved',
    },
  };
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
