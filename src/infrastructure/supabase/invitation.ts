import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';
import { mapInvitationRow, sortInvitations, type Invitation } from '../../domain/invitation.ts';
import {
  classifyPostgrestError,
  classifyRpcError,
  type PlanningResult,
  type RpcErrorRule,
} from '../../domain/planningError.ts';

// Typed feature-level read/write boundary over public.occurrence_invitations
// (Issue #33). invite_to_occurrence and decline_occurrence_invitation are the
// *only* supported write paths (the table carries no INSERT/UPDATE grant at
// all - see supabase/migrations/20260822010100_create_occurrence_
// invitations.sql), so every write here goes through those RPCs rather than
// a table mutation.

export type InvitationQueryClient = SupabaseClient<Database>;

/**
 * Message-text rules for public.invite_to_occurrence's `raise exception`
 * calls (supabase/migrations/20260822010200_create_invite_to_occurrence_rpc.sql).
 * Deliberately does NOT attempt to classify anything about the invitee's own
 * participation state - the RPC itself never raises for that (see its
 * header: the three branches all return the same void), so there is no
 * message here to match against it, and adding one would just be dead code
 * that could never fire.
 */
export const INVITE_ERROR_RULES: readonly RpcErrorRule[] = [
  { test: (m) => m.includes('authentication required'), kind: 'unauthenticated' },
  { test: (m) => m.includes('occurrence and invitee are required'), kind: 'validation' },
  { test: (m) => m.includes('cannot invite yourself'), kind: 'validation' },
  {
    test: (m) => m.includes('only a user attending this occurrence can invite others to it'),
    kind: 'permission-denied',
  },
  {
    test: (m) =>
      m.includes('this invitation was declined; re-inviting is not a supported operation'),
    kind: 'validation',
  },
];

/**
 * Invites a user to an occurrence. Returns void on every one of the RPC's
 * three internal branches (product-rules.md opacity requirement: the
 * invitee's current participation state must never be observable from this
 * call's outcome), so a caller cannot distinguish "invitation created",
 * "invitation created, invitee already `considering`", and "invitee already
 * `attending`, nothing written" - by design.
 */
export async function inviteToOccurrence(
  client: InvitationQueryClient,
  occurrenceId: string,
  inviteeId: string,
): Promise<PlanningResult<void>> {
  const { error } = await client.rpc('invite_to_occurrence', {
    p_occurrence_id: occurrenceId,
    p_invitee_id: inviteeId,
  });
  if (error !== null) {
    return { ok: false, error: classifyRpcError(error, INVITE_ERROR_RULES) };
  }
  return { ok: true, data: undefined };
}

/**
 * Every invitation the caller has received, across all occurrences.
 * occurrence_invitations_select_invitee restricts SELECT to invitee_id =
 * auth.uid(), so this can never surface an invitation the caller sent - see
 * this module's header for why there is deliberately no such operation.
 */
export async function listMyReceivedInvitations(
  client: InvitationQueryClient,
): Promise<PlanningResult<Invitation[]>> {
  const { data, error } = await client.from('occurrence_invitations').select();
  if (error !== null) {
    return { ok: false, error: classifyPostgrestError(error) };
  }
  return { ok: true, data: sortInvitations(data.map(mapInvitationRow)) };
}

export const DECLINE_ERROR_RULES: readonly RpcErrorRule[] = [
  { test: (m) => m.includes('authentication required'), kind: 'unauthenticated' },
  { test: (m) => m.includes('invitation is required'), kind: 'validation' },
  // Deliberately the same message (and therefore the same PlanningError
  // kind) whether the invitation does not exist or belongs to somebody else
  // - see decline_occurrence_invitation's header comment: an invitation is
  // readable only by its two parties, and this must not become a probe for
  // whether a given id exists.
  { test: (m) => m.includes('invitation not found'), kind: 'not-found' },
];

/**
 * Declines an invitation as its invitee. Idempotent: declining an
 * already-declined invitation returns it unchanged rather than erroring or
 * re-stamping declined_at.
 */
export async function declineInvitation(
  client: InvitationQueryClient,
  invitationId: string,
): Promise<PlanningResult<Invitation>> {
  const { data, error } = await client.rpc('decline_occurrence_invitation', {
    p_invitation_id: invitationId,
  });
  if (error !== null) {
    return { ok: false, error: classifyRpcError(error, DECLINE_ERROR_RULES) };
  }
  return { ok: true, data: mapInvitationRow(data) };
}
