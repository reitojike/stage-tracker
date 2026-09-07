'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient.ts';
import {
  setParticipation,
  withdrawParticipation,
} from '@/infrastructure/supabase/participation.ts';
import {
  declineInvitation,
  inviteToOccurrenceByEmail,
} from '@/infrastructure/supabase/invitation.ts';
import { parseInviteeEmail } from '@/domain/invitationWrite.ts';
import {
  acceptedOperationState,
  rejectedOperationState,
  resolveOperationFeedback,
  resolveOperationFeedbackForError,
  resolveOperationNotice,
  type OperationFeedback,
  type OperationState,
} from '@/domain/participationFeedback.ts';
import { readId } from './formHelpers.ts';

// Server actions for the participation / invitation UI journey (Issue #36,
// updated by Issue #225/#230's pending-only Invitation model). None of these
// actions decides permission or eligibility - that is enforced by the typed
// planning boundary these call (src/infrastructure/supabase/participation.ts,
// invitation.ts) and, under it, by RLS/RPC (supabase/migrations/).
// inviteToOccurrenceAction below still reads FormData and turns the typed
// boundary's own PlanningResult into the state a <form> renders, mirroring
// src/app/catalog/_actions/eventWrite.ts's shape; the other actions below are
// imperative, plain-parameter entry points for call sites that drive their
// writes from local component state instead (see QuickActionResult's own
// doc comment).

type ParticipationIntent = 'considering' | 'attending' | 'withdraw';

/**
 * Invites a user, by their exact registered email address, to an
 * occurrence the caller is `attending` (Issue #36 PO checkpoint,
 * 2026-08-23). The success notice is always the same text regardless of
 * what inviteToOccurrenceByEmail actually did internally - see that
 * function's header and domain/participationFeedback.ts's
 * resolveOperationNotice for why: the outcome must not reveal the
 * invitee's participation state.
 */
export async function inviteToOccurrenceAction(
  previous: OperationState,
  formData: FormData,
): Promise<OperationState> {
  const eventId = readId(formData, 'eventId');
  const occurrenceId = readId(formData, 'occurrenceId');
  const emailRaw = formData.get('email');

  if (eventId === null || occurrenceId === null || typeof emailRaw !== 'string') {
    return rejectedOperationState(
      previous,
      resolveOperationFeedback('invite-to-occurrence', 'failure'),
    );
  }

  const parsed = parseInviteeEmail(emailRaw);
  if (!parsed.ok) {
    return rejectedOperationState(previous, null, parsed.fieldError, { email: emailRaw });
  }

  const client = await createSupabaseServerClient();
  const result = await inviteToOccurrenceByEmail(client, occurrenceId, parsed.email);
  if (!result.ok) {
    return rejectedOperationState(
      previous,
      resolveOperationFeedbackForError('invite-to-occurrence', result.error),
      null,
      { email: emailRaw },
    );
  }

  revalidatePath(`/catalog/events/${eventId}`);
  return acceptedOperationState(previous, resolveOperationNotice('invite-to-occurrence'));
}

/**
 * Quick-action result for imperative, non-<form> call sites (Issue #225/#230
 * addendum): the Invitation list's InvitationCard (instant accept, an
 * 8-second client-local decline-undo window) and the Event detail
 * Participation sheet (a row click saves immediately and closes the sheet,
 * with no separate confirm/save button) both drive their writes
 * imperatively from local component state rather than through
 * useActionState + <form>, so these actions take plain parameters and
 * return a small ok/feedback shape instead of OperationState.
 */
export interface QuickActionResult {
  ok: boolean;
  feedback: OperationFeedback | null;
}

/**
 * Sets or withdraws the caller's own participation for one occurrence from
 * the Event detail Participation sheet (Issue #230 addendum): considering /
 * attending / withdraw, through the same typed boundary calls
 * (src/infrastructure/supabase/participation.ts) as every other participation
 * write in this file.
 */
export async function setParticipationChoiceAction(
  eventId: string,
  occurrenceId: string,
  choice: ParticipationIntent,
  participationId: string | null,
): Promise<QuickActionResult> {
  const client = await createSupabaseServerClient();

  if (choice === 'withdraw') {
    if (participationId === null) {
      return { ok: true, feedback: null };
    }
    const result = await withdrawParticipation(client, participationId);
    if (!result.ok) {
      return {
        ok: false,
        feedback: resolveOperationFeedback('withdraw-participation', result.error.kind),
      };
    }
    revalidatePath(`/catalog/events/${eventId}`);
    return { ok: true, feedback: null };
  }

  const result = await setParticipation(client, occurrenceId, { status: choice });
  if (!result.ok) {
    return {
      ok: false,
      feedback: resolveOperationFeedbackForError('set-participation', result.error),
    };
  }
  revalidatePath(`/catalog/events/${eventId}`);
  if (choice === 'attending') {
    // A transition to attending here converges pending invitations via the
    // occurrence_participations_resolve_invitations_on_attending trigger
    // (supabase/migrations/20260830000000_simplify_invitation_pending_only.sql)
    // exactly like acceptInvitationAction below - revalidate the same two
    // surfaces that read pending invitation state so a soft-navigation back
    // to either never shows an already-resolved invitation as still pending.
    revalidatePath('/catalog/invitations');
    revalidatePath('/mypage');
  }
  return { ok: true, feedback: null };
}

/**
 * Accepts a pending invitation by setting the caller's own participation for
 * its occurrence to `attending` - this *is* "accept" under the new pending-
 * only model (Issue #225/#230): there is no separate accept RPC, because the
 * resulting Participation must be indistinguishable from one set through the
 * ordinary Event/Occurrence UI, and both now go through this exact same
 * setParticipation call. The DB trigger `occurrence_participations_resolve_
 * invitations_on_attending` (supabase/migrations/20260830000000_simplify_
 * invitation_pending_only.sql) is what resolves the pending invitation(s) as
 * a side effect of this write - not this action.
 */
export async function acceptInvitationAction(
  occurrenceId: string,
  eventId: string | null,
): Promise<QuickActionResult> {
  const client = await createSupabaseServerClient();
  const result = await setParticipation(client, occurrenceId, { status: 'attending' });
  if (!result.ok) {
    return {
      ok: false,
      feedback: resolveOperationFeedbackForError('set-participation', result.error),
    };
  }
  revalidatePath('/catalog/invitations');
  revalidatePath('/mypage');
  if (eventId !== null) {
    revalidatePath(`/catalog/events/${eventId}`);
  }
  return { ok: true, feedback: null };
}

/**
 * Finalizes a decline: resolves (deletes) the pending invitation without
 * touching the invitee's own Participation. Called once the client-local
 * 8-second undo window elapses or the invitations screen is left, never
 * directly from the "参加しない" click itself (see
 * src/app/catalog/_components/InvitationCard.tsx) - the addendum's undo
 * requirement is implemented entirely client-side by delaying this call,
 * with no new persisted "declining" state.
 *
 * declineInvitation's `data: null` (already resolved) is treated the same as
 * a fresh deletion - both mean "no longer pending", which is exactly what
 * this finalize call is trying to ensure.
 */
export async function finalizeDeclineInvitationAction(
  invitationId: string,
): Promise<QuickActionResult> {
  const client = await createSupabaseServerClient();
  const result = await declineInvitation(client, invitationId);
  if (!result.ok) {
    return {
      ok: false,
      feedback: resolveOperationFeedback('decline-invitation', result.error.kind),
    };
  }
  revalidatePath('/catalog/invitations');
  return { ok: true, feedback: null };
}
