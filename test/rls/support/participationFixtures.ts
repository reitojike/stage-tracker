import type { PostgrestError } from '@supabase/supabase-js';
import type { Database } from '../../../src/infrastructure/supabase/database.types.ts';
import type { TestActor } from './testActors.ts';
import { createEventWithOccurrence } from './eventFixtures.ts';

// Shared fixture helpers for occurrence-level participation/invitation tests
// (Issue #30).
//
// Everything here goes through a normal authenticated client, never
// service_role: creating your own participation *is* the product operation,
// so a fixture that took a shortcut around RLS would quietly weaken the
// tests that build on it. The same holds for assertions in the tests - a
// private participation is read back through its own owner's client rather
// than an admin client, so the read path stays under RLS too.

export type ParticipationStatus = Database['public']['Enums']['participation_status'];
export type ParticipationVisibility = Database['public']['Enums']['participation_visibility'];
export type ParticipationRow = Database['public']['Tables']['occurrence_participations']['Row'];
export type InvitationRow = Database['public']['Tables']['occurrence_invitations']['Row'];

/**
 * Creates the actor's own participation for an occurrence, through the table
 * API as themselves. `visibility` is left out of the request entirely when
 * not supplied, so callers can exercise the column default.
 */
export async function setParticipation(
  actor: TestActor,
  occurrenceId: string,
  status: ParticipationStatus,
  visibility?: ParticipationVisibility,
): Promise<ParticipationRow> {
  const row: Database['public']['Tables']['occurrence_participations']['Insert'] = {
    occurrence_id: occurrenceId,
    user_id: actor.user.id,
    status,
  };
  if (visibility !== undefined) {
    row.visibility = visibility;
  }

  const { data, error } = await actor.client
    .from('occurrence_participations')
    .insert(row)
    .select()
    .single();
  if (error) {
    throw new Error(`fixture participation insert failed: ${error.message}`);
  }
  return data;
}

/**
 * Reads an actor's own participation for an occurrence, or null when they
 * have none. Read as the participant themselves, so it works regardless of
 * the row's visibility.
 */
export async function readOwnParticipation(
  actor: TestActor,
  occurrenceId: string,
): Promise<ParticipationRow | null> {
  const { data, error } = await actor.client
    .from('occurrence_participations')
    .select()
    .eq('occurrence_id', occurrenceId)
    .eq('user_id', actor.user.id);
  if (error) {
    throw new Error(`fixture participation read failed: ${error.message}`);
  }
  if (data.length > 1) {
    throw new Error(
      `expected at most one participation per (occurrence, user), found ${String(data.length)}`,
    );
  }
  return data[0] ?? null;
}

export async function inviteToOccurrence(
  actor: TestActor,
  occurrenceId: string,
  inviteeId: string,
): Promise<{ data: InvitationRow | null; error: PostgrestError | null }> {
  return actor.client.rpc('invite_to_occurrence', {
    p_occurrence_id: occurrenceId,
    p_invitee_id: inviteeId,
  });
}

export async function inviteToOccurrenceOrThrow(
  actor: TestActor,
  occurrenceId: string,
  inviteeId: string,
): Promise<InvitationRow> {
  const { data, error } = await inviteToOccurrence(actor, occurrenceId, inviteeId);
  if (error) {
    throw new Error(`fixture invite_to_occurrence failed: ${error.message}`);
  }
  if (!data) {
    throw new Error('fixture invite_to_occurrence returned no invitation');
  }
  return data;
}

/**
 * The standard setup for invitation tests: an occurrence owned by
 * `catalogOwner`, with `inviter` already `attending` it - the only state
 * that makes someone eligible to invite.
 */
export async function createOccurrenceWithAttendee(
  catalogOwner: TestActor,
  inviter: TestActor,
): Promise<{ eventId: string; occurrenceId: string }> {
  const { event, occurrence } = await createEventWithOccurrence(catalogOwner);
  await setParticipation(inviter, occurrence.id, 'attending');
  return { eventId: event.id, occurrenceId: occurrence.id };
}
