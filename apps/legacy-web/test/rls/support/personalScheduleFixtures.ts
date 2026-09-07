import type { TestActor } from './testActors.ts';

// Shared fixture helpers for public.personal_schedule_entries /
// public.personal_schedule_shares (Issue #31, re-modeled from a closed
// schedule_type vocabulary to free-form title + blocking by Issue #121).
// Unlike events, entry creation has no atomicity invariant that requires an
// RPC (see 20260822000000_create_personal_schedule.sql): a plain INSERT is
// the supported create path.

export function scheduleEntryTitle(): string {
  return `rls test schedule entry ${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
}

export function scheduleEntryMemo(): string {
  return `rls test schedule entry memo ${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
}

export interface AllDayScheduleEntryOverrides {
  title?: string;
  blocking?: boolean;
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
      title: overrides.title ?? scheduleEntryTitle(),
      blocking: overrides.blocking ?? true,
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
  title?: string;
  blocking?: boolean;
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
      title: overrides.title ?? scheduleEntryTitle(),
      blocking: overrides.blocking ?? true,
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
