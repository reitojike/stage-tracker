// Occurrence-level invitation domain model (Issue #33), over the
// persistence/RLS baseline Issue #30 established
// (supabase/migrations/20260822010100_create_occurrence_invitations.sql and
// the invite/decline RPC migrations).
//
// Product semantics (see .ai-dev-foundation/product-rules.md, "Invitation"):
// - Targets an occurrence; invite/decline are the only two lifecycle facts.
// - Only the invitee may read an invitation row - not the inviter. This is
//   deliberate (product-rules.md opacity requirement), so this module
//   provides no "list invitations I sent" operation: there is nothing for it
//   to read, and adding one would invite a future caller to reach for a
//   query that RLS silently returns empty for instead of erroring.
//
// This module is pure domain logic: no Supabase/DB import (see the
// architecture import boundary in eslint.config.mjs).

import { compareByFieldThenId, sortByFieldThenId } from './ordering.ts';

export interface Invitation {
  id: string;
  occurrenceId: string;
  inviterId: string;
  inviteeId: string;
  /**
   * Issue #225/#230: Invitation is now pending-only - declining, accepting,
   * or converging on `attending` from any other path all resolve (delete)
   * the row instead of stamping this field (see supabase/migrations/
   * 20260830000000_simplify_invitation_pending_only.sql). A fetched
   * Invitation is therefore always effectively pending; this field is
   * retained only because the underlying `occurrence_invitations.declined_at`
   * column itself is not dropped in this PR (legacy-schema-drop is deferred
   * to a later bounded Issue) - no current write path ever sets it again,
   * and no current read path should branch on it.
   */
  declinedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The persistence row shape mapInvitationRow expects, declared locally
 * matching the convention in domain/eventCatalog.ts's RawEventRow. */
export interface RawInvitationRow {
  id: string;
  occurrence_id: string;
  inviter_id: string;
  invitee_id: string;
  declined_at: string | null;
  created_at: string;
  updated_at: string;
}

export function mapInvitationRow(row: RawInvitationRow): Invitation {
  return {
    id: row.id,
    occurrenceId: row.occurrence_id,
    inviterId: row.inviter_id,
    inviteeId: row.invitee_id,
    declinedAt: row.declined_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Deterministic ordering: created_at ascending, id as a stable tie-breaker
 * - see domain/ordering.ts. */
export function compareInvitationsByCreatedAt(a: Invitation, b: Invitation): number {
  return compareByFieldThenId(a, b, (invitation) => invitation.createdAt);
}

export function sortInvitations(invitations: readonly Invitation[]): Invitation[] {
  return sortByFieldThenId(invitations, (invitation) => invitation.createdAt);
}
