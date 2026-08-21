import type { TestActor } from './testActors.ts';
import { readLocalSupabaseStatus } from './localSupabase.ts';

// Shared fixture helpers for public.personal_schedule_entries /
// public.personal_schedule_shares (Issue #31). Unlike events, entry
// creation has no atomicity invariant that requires an RPC (see
// 20260822000000_create_personal_schedule.sql): a plain INSERT is the
// supported create path.

export type ScheduleType = 'paid_leave' | 'work' | 'travel' | 'other';

export function scheduleEntryMemo(): string {
  return `rls test schedule entry ${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
}

export interface AllDayScheduleEntryOverrides {
  scheduleType?: ScheduleType;
  memo?: string;
  startsOn?: string;
  endsOn?: string;
}

/**
 * Inserts an all-day entry. Defaults to a single-day entry (startsOn ===
 * endsOn); pass a later endsOn for a multi-day entry.
 */
export async function createAllDayScheduleEntry(
  actor: TestActor,
  overrides: AllDayScheduleEntryOverrides = {},
) {
  const startsOn = overrides.startsOn ?? new Date().toISOString().slice(0, 10);
  const { data, error } = await actor.client
    .from('personal_schedule_entries')
    .insert({
      owner_id: actor.user.id,
      schedule_type: overrides.scheduleType ?? 'other',
      memo: overrides.memo ?? scheduleEntryMemo(),
      is_all_day: true,
      starts_on: startsOn,
      ends_on: overrides.endsOn ?? startsOn,
    })
    .select()
    .single();
  if (error) {
    throw new Error(`fixture all-day schedule entry insert failed: ${error.message}`);
  }
  return data;
}

export interface TimedScheduleEntryOverrides {
  scheduleType?: ScheduleType;
  memo?: string;
  startsAt?: string;
  endsAt?: string;
}

export async function createTimedScheduleEntry(
  actor: TestActor,
  overrides: TimedScheduleEntryOverrides = {},
) {
  const { data, error } = await actor.client
    .from('personal_schedule_entries')
    .insert({
      owner_id: actor.user.id,
      schedule_type: overrides.scheduleType ?? 'other',
      memo: overrides.memo ?? scheduleEntryMemo(),
      is_all_day: false,
      starts_at: overrides.startsAt ?? new Date().toISOString(),
      ends_at: overrides.endsAt,
    })
    .select()
    .single();
  if (error) {
    throw new Error(`fixture timed schedule entry insert failed: ${error.message}`);
  }
  return data;
}

/**
 * Shares an existing entry with a recipient, as the entry owner. Returns
 * the created personal_schedule_shares row.
 */
export async function shareScheduleEntry(
  ownerActor: TestActor,
  scheduleEntryId: string,
  recipientUserId: string,
) {
  const { data, error } = await ownerActor.client
    .from('personal_schedule_shares')
    .insert({ schedule_entry_id: scheduleEntryId, shared_with_user_id: recipientUserId })
    .select()
    .single();
  if (error) {
    throw new Error(`fixture schedule share insert failed: ${error.message}`);
  }
  return data;
}

/**
 * Inserts into personal_schedule_entries over raw HTTP with an arbitrary
 * JSON body, bypassing the generated Row/Insert type entirely. Used only for
 * negative tests that need to send a request shape the typed
 * `actor.client.from(...).insert(...)` call structurally cannot express
 * (e.g. a schedule_type outside the generated union) - proving server-side
 * enforcement rather than client-side type-system enforcement. Mirrors
 * callCreateEventRpcRaw in eventFixtures.ts.
 */
export async function callInsertScheduleEntryRaw(
  actor: TestActor,
  body: Record<string, unknown>,
): Promise<Response> {
  const { data, error } = await actor.client.auth.getSession();
  if (error) {
    throw new Error(`failed to read session for raw insert call: ${error.message}`);
  }
  if (!data.session) {
    throw new Error('actor has no active session for raw insert call');
  }

  const status = readLocalSupabaseStatus();
  return fetch(`${status.apiUrl}/rest/v1/personal_schedule_entries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: status.anonKey,
      Authorization: `Bearer ${data.session.access_token}`,
    },
    body: JSON.stringify(body),
  });
}
