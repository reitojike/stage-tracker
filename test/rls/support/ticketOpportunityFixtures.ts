import { createAdminClient, type TestActor } from './testActors.ts';
import { createEventWithOccurrence } from './eventFixtures.ts';
import type { Json } from '../../../src/infrastructure/supabase/database.types.ts';

// Deliberately self-contained (no import from src/domain), mirroring
// eventFixtures.ts's own tokyoCalendarDate - Asia/Tokyo has a fixed +09:00
// offset with no DST, so this arithmetic is safe here too.
const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;

function tokyoCalendarDate(instantIso: string): string {
  const tokyo = new Date(Date.parse(instantIso) + TOKYO_OFFSET_MS);
  const year = String(tokyo.getUTCFullYear()).padStart(4, '0');
  const month = String(tokyo.getUTCMonth() + 1).padStart(2, '0');
  const day = String(tokyo.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Shared fixture helpers for the TicketOpportunity slice (Issue #162).
// ticket_opportunities / ticket_opportunity_target_occurrences /
// ticket_opportunity_milestones have no authenticated INSERT/UPDATE/DELETE
// grant at all (see supabase/migrations/20260828000000_create_ticket_
// opportunities.sql and the two migrations after it) - the only write path
// is the service_role-only import_ticket_opportunity RPC, so every fixture
// here goes through the admin client, mirroring how #163's real operator
// import script will call it. user_ticket_opportunity_states, by contrast,
// is written directly by the acting user's own client in the tests that
// exercise it - see test/rls/userTicketOpportunityStates.test.ts.

let opportunitySeq = 0;

export function opportunitySourceKey(): string {
  opportunitySeq += 1;
  return `rls-test:opportunity:${String(Date.now())}-${String(opportunitySeq)}-${Math.random().toString(36).slice(2)}`;
}

// The index signature (in addition to the named fields below) is what lets
// this satisfy Json without a type assertion at the RPC call site below -
// Json's own object variant is `{ [key: string]: Json | undefined }`, and
// every named field here is a Json-compatible subtype of that.
export interface MilestoneInput {
  [key: string]: Json | undefined;
  milestone_type: string;
  temporal_precision: string;
  date_value?: string;
  at?: string;
  starts_at?: string;
  ends_at?: string;
}

export interface ImportOpportunityOptions {
  displayName?: string;
  sourceKey?: string;
  targetScope?: 'event_wide' | 'selected_occurrences';
  occurrenceIds?: string[];
  sourceUrl?: string;
  memo?: string;
  milestones?: MilestoneInput[];
}

/**
 * Imports one TicketOpportunity through the real service_role RPC, for an
 * event created via the normal catalogOwner fixture path. Errors are
 * surfaced (not swallowed) so a fixture that stopped working cannot quietly
 * turn a positive test into a vacuous one, matching the convention in
 * support/ticketFixtures.ts.
 */
export async function importOpportunity(eventId: string, options: ImportOpportunityOptions = {}) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('import_ticket_opportunity', {
    p_event_id: eventId,
    p_source_key: options.sourceKey ?? opportunitySourceKey(),
    p_display_name: options.displayName ?? '第1抽選',
    p_target_scope: options.targetScope ?? 'event_wide',
    p_occurrence_ids: options.occurrenceIds,
    p_source_url: options.sourceUrl,
    p_memo: options.memo,
    p_milestones: options.milestones ?? [],
  });
  if (error) {
    throw new Error(`fixture import_ticket_opportunity failed: ${error.message}`);
  }
  return data;
}

/**
 * An event with two occurrences (catalogOwner-owned) plus one
 * selected_occurrences opportunity targeting both, ready for target-scope
 * and milestone tests.
 */
export async function createEventWithOpportunity(
  catalogOwner: TestActor,
  options: ImportOpportunityOptions = {},
) {
  const secondStartsAt = new Date(Date.now() + 86_400_000).toISOString();
  // The Event range (starts_on/ends_on) must contain both occurrences'
  // Tokyo calendar dates (product-rules.md "公演回の日付は...Event range内
  // に収まっていなければならない", DB-enforced) - the second occurrence
  // added below is deliberately a day after the first, so endsOn has to be
  // widened to cover it rather than defaulting to the first occurrence's
  // own date alone.
  const { event, occurrence } = await createEventWithOccurrence(catalogOwner, {
    endsOn: tokyoCalendarDate(secondStartsAt),
  });
  const { data: secondOccurrence, error } = await catalogOwner.client
    .from('event_occurrences')
    .insert({ event_id: event.id, starts_at: secondStartsAt })
    .select()
    .single();
  if (error) {
    throw new Error(`fixture second occurrence insert failed: ${error.message}`);
  }

  // Not a plain `{ defaults, ...options }` spread: options.targetScope
  // alone (e.g. a caller passing { targetScope: 'event_wide' } to opt out
  // of targeting) would otherwise leave the two-occurrence default array
  // in place, since object spread only overwrites keys options actually
  // has - sending an event_wide import with non-empty occurrenceIds, which
  // the RPC rejects. Deriving occurrenceIds from the *effective*
  // targetScope keeps the two in sync regardless of which one the caller
  // overrides.
  const targetScope = options.targetScope ?? 'selected_occurrences';
  const occurrenceIds =
    options.occurrenceIds ??
    (targetScope === 'selected_occurrences' ? [occurrence.id, secondOccurrence.id] : undefined);

  const opportunity = await importOpportunity(event.id, {
    ...options,
    targetScope,
    occurrenceIds,
  });
  return { event, occurrence, secondOccurrence, opportunity };
}

export async function readOpportunityAsAdmin(opportunityId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('ticket_opportunities')
    .select()
    .eq('id', opportunityId)
    .single();
  if (error) {
    throw new Error(`fixture opportunity read failed: ${error.message}`);
  }
  return data;
}

export async function readTargetOccurrencesAsAdmin(opportunityId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('ticket_opportunity_target_occurrences')
    .select()
    .eq('opportunity_id', opportunityId);
  if (error) {
    throw new Error(`fixture target occurrences read failed: ${error.message}`);
  }
  return data;
}

export async function readMilestonesAsAdmin(opportunityId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('ticket_opportunity_milestones')
    .select()
    .eq('opportunity_id', opportunityId);
  if (error) {
    throw new Error(`fixture milestones read failed: ${error.message}`);
  }
  return data;
}

export async function readMyStateAsAdmin(userId: string, opportunityId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('user_ticket_opportunity_states')
    .select()
    .eq('user_id', userId)
    .eq('opportunity_id', opportunityId)
    .maybeSingle();
  if (error) {
    throw new Error(`fixture user state read failed: ${error.message}`);
  }
  return data;
}
