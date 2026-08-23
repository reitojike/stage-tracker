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

/**
 * invite_to_occurrence returns void: the caller is told nothing about which
 * product branch was taken, because that is the invitee's private
 * participation state. Tests therefore assert on what the *invitee* can see,
 * never on a return value.
 */
export async function inviteToOccurrence(
  actor: TestActor,
  occurrenceId: string,
  inviteeId: string,
): Promise<{ error: PostgrestError | null }> {
  const { error } = await actor.client.rpc('invite_to_occurrence', {
    p_occurrence_id: occurrenceId,
    p_invitee_id: inviteeId,
  });
  return { error };
}

export async function inviteToOccurrenceOrThrow(
  actor: TestActor,
  occurrenceId: string,
  inviteeId: string,
): Promise<void> {
  const { error } = await inviteToOccurrence(actor, occurrenceId, inviteeId);
  if (error) {
    throw new Error(`fixture invite_to_occurrence failed: ${error.message}`);
  }
}

/** Same shape as inviteToOccurrence above, but for the email-based RPC
 * (Issue #36). Returns void in every invitee-dependent branch - see
 * supabase/migrations/20260823000000_create_invite_to_occurrence_by_email_rpc.sql. */
export async function inviteToOccurrenceByEmail(
  actor: TestActor,
  occurrenceId: string,
  inviteeEmail: string,
): Promise<{ error: PostgrestError | null }> {
  const { error } = await actor.client.rpc('invite_to_occurrence_by_email', {
    p_occurrence_id: occurrenceId,
    p_invitee_email: inviteeEmail,
  });
  return { error };
}

export async function inviteToOccurrenceByEmailOrThrow(
  actor: TestActor,
  occurrenceId: string,
  inviteeEmail: string,
): Promise<void> {
  const { error } = await inviteToOccurrenceByEmail(actor, occurrenceId, inviteeEmail);
  if (error) {
    throw new Error(`fixture invite_to_occurrence_by_email failed: ${error.message}`);
  }
}

/** Supabase's User type declares `email` optional; every test actor here is
 * created with an explicit email (see createTestActor), so this is always
 * present in practice. Narrows with a runtime check rather than a type
 * assertion, throwing loudly if that assumption is ever wrong. */
export function requireActorEmail(actor: TestActor): string {
  const email = actor.user.email;
  if (email === undefined) {
    throw new Error(`test actor ${actor.user.id} has no email`);
  }
  return email;
}

/**
 * Reads the invitations an invitee has received for an occurrence, through
 * their own client. Only the invitee can read an invitation
 * (occurrence_invitations_select_invitee), so this is the only non-admin way
 * to observe that an invite actually created a row.
 */
export async function invitationsReceived(
  invitee: TestActor,
  occurrenceId: string,
): Promise<InvitationRow[]> {
  const { data, error } = await invitee.client
    .from('occurrence_invitations')
    .select()
    .eq('occurrence_id', occurrenceId);
  if (error) {
    throw new Error(`fixture invitation read failed: ${error.message}`);
  }
  return data;
}

/**
 * The single invitation an invitee received for an occurrence, or null. Throws
 * if there is more than one, so a test that means "the invitation" cannot pass
 * by silently picking one of several.
 */
export async function invitationReceived(
  invitee: TestActor,
  occurrenceId: string,
): Promise<InvitationRow | null> {
  const rows = await invitationsReceived(invitee, occurrenceId);
  if (rows.length > 1) {
    throw new Error(`expected at most one invitation, found ${String(rows.length)}`);
  }
  return rows[0] ?? null;
}

export async function declineInvitation(
  actor: TestActor,
  invitationId: string,
): Promise<{ data: InvitationRow | null; error: PostgrestError | null }> {
  return actor.client.rpc('decline_occurrence_invitation', {
    p_invitation_id: invitationId,
  });
}

export async function declineInvitationOrThrow(
  actor: TestActor,
  invitationId: string,
): Promise<InvitationRow> {
  const { data, error } = await declineInvitation(actor, invitationId);
  if (error) {
    throw new Error(`fixture decline_occurrence_invitation failed: ${error.message}`);
  }
  if (!data) {
    throw new Error('fixture decline_occurrence_invitation returned no invitation');
  }
  return data;
}

/**
 * Reads a single invitation by id through the given actor's own client.
 * Returns null when that actor cannot see it - which, since only the invitee
 * has SELECT, is the expected result for everyone else.
 */
export async function readInvitation(
  actor: TestActor,
  invitationId: string,
): Promise<InvitationRow | null> {
  const { data, error } = await actor.client
    .from('occurrence_invitations')
    .select()
    .eq('id', invitationId);
  if (error) {
    throw new Error(`fixture invitation read failed: ${error.message}`);
  }
  return data[0] ?? null;
}

/**
 * The standard setup for invitation tests: an occurrence owned by
 * `catalogOwner`, with `inviter` already `attending` it - the only state
 * that makes someone eligible to invite.
 *
 * `catalogOwner` must be a designated catalog creator (Issue #29), since
 * creating the parent event goes through create_event_with_occurrence.
 */
export async function createOccurrenceWithAttendee(
  catalogOwner: TestActor,
  inviter: TestActor,
): Promise<{ eventId: string; occurrenceId: string }> {
  const { event, occurrence } = await createEventWithOccurrence(catalogOwner);
  await setParticipation(inviter, occurrence.id, 'attending');
  return { eventId: event.id, occurrenceId: occurrence.id };
}
