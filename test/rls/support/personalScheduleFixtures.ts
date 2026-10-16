import type { TestActor } from './testActors.ts';

// Shared fixture helpers for public.personal_schedule_entries /
// public.personal_schedule_shares (Issue #31, re-modeled from a closed
// schedule_type vocabulary to free-form title + blocking by Issue #121).
// Unlike events, entry creation has no atomicity invariant that requires an
// RPC (see 20260822000000_create_personal_schedule.sql): a plain INSERT is
// the supported create path. Sharing requires an accepted contact created
// through the authenticated request/accept flow.

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

/** Establishes an accepted contact through both authenticated actors. */
export async function ensureAcceptedScheduleContact(
  ownerActor: TestActor,
  recipientActor: TestActor,
) {
  const ownerEmail = ownerActor.user.email;
  const recipientEmail = recipientActor.user.email;
  if (!ownerEmail) throw new Error(`fixture owner ${ownerActor.user.id} has no email`);
  if (!recipientEmail) throw new Error(`fixture recipient ${recipientActor.user.id} has no email`);
  const normalizedRecipientEmail = recipientEmail.toLowerCase();

  async function findContact() {
    const { data, error } = await ownerActor.client.rpc('list_schedule_contacts');
    if (error) throw new Error(`fixture list_schedule_contacts failed: ${error.message}`);
    return data.find(
      (contact) => contact.counterpart_email.toLowerCase() === normalizedRecipientEmail,
    );
  }

  const existingContact = await findContact();
  if (existingContact) return existingContact.contact_id;

  const { error: requestError } = await ownerActor.client.rpc('request_schedule_contact_by_email', {
    p_recipient_email: recipientEmail,
  });
  if (requestError) {
    throw new Error(`fixture request_schedule_contact_by_email failed: ${requestError.message}`);
  }

  const { data: requests, error: listError } = await recipientActor.client.rpc(
    'list_received_schedule_contact_requests',
  );
  if (listError) {
    throw new Error(`fixture list_received_schedule_contact_requests failed: ${listError.message}`);
  }
  const request = requests.find(
    (item) => item.requester_email.toLowerCase() === ownerEmail.toLowerCase(),
  );
  if (!request) {
    throw new Error(`fixture contact request from ${ownerEmail} was not received`);
  }

  const { error: acceptError } = await recipientActor.client.rpc(
    'accept_schedule_contact_request',
    { p_request_id: request.request_id },
  );
  if (acceptError) {
    throw new Error(`fixture accept_schedule_contact_request failed: ${acceptError.message}`);
  }

  const acceptedContact = await findContact();
  if (!acceptedContact) {
    throw new Error(`fixture accepted contact with ${recipientEmail} was not listed`);
  }
  return acceptedContact.contact_id;
}

/** Shares an entry through its accepted contact and returns its share row. */
export async function shareScheduleEntry(
  ownerActor: TestActor,
  scheduleEntryId: string,
  recipientActor: TestActor,
) {
  const contactId = await ensureAcceptedScheduleContact(ownerActor, recipientActor);
  const { data, error } = await ownerActor.client.rpc('share_schedule_entry_with_contact', {
    p_schedule_entry_id: scheduleEntryId,
    p_contact_id: contactId,
  });
  if (error) {
    throw new Error(`fixture share_schedule_entry_with_contact failed: ${error.message}`);
  }
  return data;
}
