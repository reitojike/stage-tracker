import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';
import {
  mapInvitationRow,
  sortInvitations,
  type Invitation,
  type RawInvitationRow,
} from '../../domain/invitation.ts';
import {
  classifyRpcError,
  type PlanningResult,
  type RpcErrorRule,
} from '../../domain/planningError.ts';
import { fetchAllRows } from './pagedFetch.ts';
import { requireAuthenticatedUserId } from './planningAuth.ts';

// Typed feature-level read/write boundary over public.occurrence_invitations
// (Issue #33). invite_to_occurrence and decline_occurrence_invitation are the
// *only* supported write paths (the table carries no INSERT/UPDATE grant at
// all - see supabase/migrations/20260822010100_create_occurrence_
// invitations.sql), so every write here goes through those RPCs rather than
// a table mutation.

export type InvitationQueryClient = SupabaseClient<Database>;

/**
 * Narrows decline_occurrence_invitation's RPC result via `unknown` rather
 * than a type assertion (this repo's lint profile forbids `as`/`<T>`
 * assertions - "narrow unknown instead", the same convention
 * domain/catalogFilterSheet.ts's isStringArray/isRecordOfStringArrays use).
 * decline_occurrence_invitation is declared to return
 * public.occurrence_invitations (a single row), but genuinely returns SQL
 * NULL when no matching pending row was found (see its migration) -
 * Postgres's row-returning-function signature carries no nullability
 * Supabase's type generator can see, so the generated RPC return type
 * (database.types.ts) is a plain row shape, not `| null`, even though a
 * real response can be null. This guard restores the real runtime contract.
 *
 * A genuine SQL NULL for a `returns public.occurrence_invitations` function
 * is not serialized by PostgREST as JSON `null` - it comes back as an
 * object with every column set to `null` (confirmed against local
 * Supabase). `'id' in value` alone would treat that as a real row (id:
 * null), so this checks that `id` is actually a non-null string - the one
 * field that is never null on a genuine row.
 *
 * Exported so test/rls/support/participationFixtures.ts's own declineInvitation
 * fixture - which calls the RPC directly rather than through this module, to
 * exercise the real client boundary - can reuse this exact narrowing instead
 * of re-deriving it.
 */
export function isRawInvitationRow(value: unknown): value is RawInvitationRow {
  return (
    typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string'
  );
}

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
];

/**
 * Invites a user to an occurrence. Returns void on every one of the RPC's
 * three internal branches (product-rules.md opacity requirement: the
 * invitee's current participation state must never be observable from this
 * call's outcome), so a caller cannot distinguish "invitation created",
 * "invitation created, invitee already `considering`", and "invitee already
 * `attending`, nothing written" - by design.
 *
 * Checks the caller's session first (requireAuthenticatedUserId): EXECUTE
 * on this RPC is revoked from anon (see the migration), so an anon caller
 * would otherwise reach the database and get a generic 42501, which
 * classifyRpcError falls through to `permission-denied` rather than
 * `unauthenticated` - unlike a session that reaches the RPC body and hits
 * its own `authentication required` raise (defense-in-depth, normally
 * unreachable). Checking first makes both paths report the same
 * `unauthenticated` kind.
 */
export async function inviteToOccurrence(
  client: InvitationQueryClient,
  occurrenceId: string,
  inviteeId: string,
): Promise<PlanningResult<void>> {
  const callerId = await requireAuthenticatedUserId(client);
  if (!callerId.ok) {
    return callerId;
  }

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
 * Message-text rules for public.invite_to_occurrence_by_email's `raise
 * exception` calls (supabase/migrations/20260823010000_create_invite_to_
 * occurrence_by_email_rpc.sql, Issue #55). Deliberately has no rule for a
 * "declined" or "not found" message: unlike INVITE_ERROR_RULES above, that
 * RPC never raises for anything about the invitee - see its header. Every
 * rule here is about the caller (auth, missing/malformed input, self-invite,
 * not attending).
 */
export const INVITE_BY_EMAIL_ERROR_RULES: readonly RpcErrorRule[] = [
  { test: (m) => m.includes('authentication required'), kind: 'unauthenticated' },
  { test: (m) => m.includes('occurrence and invitee email are required'), kind: 'validation' },
  { test: (m) => m.includes('invitee email is not a valid email address'), kind: 'validation' },
  { test: (m) => m.includes('cannot invite yourself'), kind: 'validation' },
  {
    test: (m) => m.includes('only a user attending this occurrence can invite others to it'),
    kind: 'permission-denied',
  },
];

/**
 * Invites a user to an occurrence by their exact registered email address
 * (Issue #55: MVP invitee targeting is exact email input, not a user
 * directory/search, and never a raw user id from a client). Opaque in the
 * same spirit as inviteToOccurrence above, but stricter: every
 * invitee-dependent outcome - no such account, no participation row,
 * `considering`, `attending`, or a previously declined invitation - returns
 * the same void. See invite_to_occurrence_by_email's header for why the
 * declined case cannot raise the distinct exception inviteToOccurrence's RPC
 * does here.
 */
export async function inviteToOccurrenceByEmail(
  client: InvitationQueryClient,
  occurrenceId: string,
  inviteeEmail: string,
): Promise<PlanningResult<void>> {
  const callerId = await requireAuthenticatedUserId(client);
  if (!callerId.ok) {
    return callerId;
  }

  const { error } = await client.rpc('invite_to_occurrence_by_email', {
    p_occurrence_id: occurrenceId,
    p_invitee_email: inviteeEmail,
  });
  if (error !== null) {
    return { ok: false, error: classifyRpcError(error, INVITE_BY_EMAIL_ERROR_RULES) };
  }
  return { ok: true, data: undefined };
}

/**
 * Every invitation the caller has received, across all occurrences.
 * occurrence_invitations_select_invitee restricts SELECT to invitee_id =
 * auth.uid(), so this can never surface an invitation the caller sent - see
 * this module's header for why there is deliberately no such operation.
 * Paginated via fetchAllRows so a caller with more rows than PostgREST's
 * api.max_rows never silently loses the rest (see pagedFetch.ts).
 */
export async function listMyReceivedInvitations(
  client: InvitationQueryClient,
): Promise<PlanningResult<Invitation[]>> {
  const result = await fetchAllRows((from, to) =>
    client
      .from('occurrence_invitations')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (!result.ok) {
    return result;
  }
  return { ok: true, data: sortInvitations(result.data.map(mapInvitationRow)) };
}

export const DECLINE_ERROR_RULES: readonly RpcErrorRule[] = [
  { test: (m) => m.includes('authentication required'), kind: 'unauthenticated' },
  { test: (m) => m.includes('invitation is required'), kind: 'validation' },
];

/**
 * Declines an invitation as its invitee (Issue #225/#230: pending-only
 * Invitation). decline_occurrence_invitation now DELETEs the row rather than
 * stamping declined_at - "resolved" is uniformly represented as row absence,
 * matching the pending-only model. Idempotent by returning `data: null`
 * rather than erroring when no matching row is found (already declined by an
 * earlier call, already resolved by the invitee accepting elsewhere, or
 * genuinely never existed) - a caller must treat `data: null` as a benign
 * no-op, not as a distinct failure to surface.
 *
 * Checks the caller's session first - see inviteToOccurrence above for why.
 */
export async function declineInvitation(
  client: InvitationQueryClient,
  invitationId: string,
): Promise<PlanningResult<Invitation | null>> {
  const callerId = await requireAuthenticatedUserId(client);
  if (!callerId.ok) {
    return callerId;
  }

  const { data, error } = await client.rpc('decline_occurrence_invitation', {
    p_invitation_id: invitationId,
  });
  if (error !== null) {
    return { ok: false, error: classifyRpcError(error, DECLINE_ERROR_RULES) };
  }
  const rawData: unknown = data;
  return { ok: true, data: isRawInvitationRow(rawData) ? mapInvitationRow(rawData) : null };
}
