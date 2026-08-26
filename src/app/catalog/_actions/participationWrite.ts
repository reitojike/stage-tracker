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
import type { ParticipationStatus } from '@/domain/participation.ts';
import { parseInviteeEmail } from '@/domain/invitationWrite.ts';
import {
  acceptedOperationState,
  rejectedOperationState,
  resolveOperationFeedback,
  resolveOperationFeedbackForError,
  resolveOperationNotice,
  resolveParticipationSetNotice,
  type OperationState,
} from '@/domain/participationFeedback.ts';
import { readId } from './formHelpers.ts';

// Server actions for the MVP participation / invitation UI journey (Issue
// #36). None of these actions decides permission or eligibility - that is
// enforced by the typed planning boundary these call
// (src/infrastructure/supabase/participation.ts, invitation.ts) and, under
// it, by RLS/RPC (supabase/migrations/). What happens here is reading
// FormData, dispatching, and turning the typed boundary's own
// PlanningResult into the state a form renders - mirroring
// src/app/catalog/_actions/eventWrite.ts's shape for the Event catalog
// write boundary.

type ParticipationIntent = 'considering' | 'attending' | 'withdraw';

function isParticipationIntent(value: string | null): value is ParticipationIntent {
  return value === 'considering' || value === 'attending' || value === 'withdraw';
}

/**
 * Sets or withdraws the caller's own participation for one occurrence. One
 * action serves all three intents (rather than three bound actions) so the
 * occurrence's participation controls stay a single <form> with several
 * submit buttons, following the same "one form, dispatch on the submitted
 * value" shape addOccurrenceAction/updateOccurrenceAction use.
 */
export async function updateParticipationAction(
  previous: OperationState,
  formData: FormData,
): Promise<OperationState> {
  const eventId = readId(formData, 'eventId');
  const occurrenceId = readId(formData, 'occurrenceId');
  const intentRaw = formData.get('intent');
  const intent = typeof intentRaw === 'string' ? intentRaw : null;

  if (eventId === null || occurrenceId === null || !isParticipationIntent(intent)) {
    return rejectedOperationState(
      previous,
      resolveOperationFeedback('set-participation', 'failure'),
    );
  }

  const client = await createSupabaseServerClient();

  if (intent === 'withdraw') {
    const participationId = readId(formData, 'participationId');
    if (participationId === null) {
      return rejectedOperationState(
        previous,
        resolveOperationFeedback('withdraw-participation', 'failure'),
      );
    }
    const result = await withdrawParticipation(client, participationId);
    if (!result.ok) {
      return rejectedOperationState(
        previous,
        resolveOperationFeedback('withdraw-participation', result.error.kind),
      );
    }
    revalidatePath(`/catalog/events/${eventId}`);
    return acceptedOperationState(previous, resolveOperationNotice('withdraw-participation'));
  }

  const status: ParticipationStatus = intent;
  const result = await setParticipation(client, occurrenceId, { status });
  if (!result.ok) {
    return rejectedOperationState(
      previous,
      resolveOperationFeedbackForError('set-participation', result.error),
    );
  }
  revalidatePath(`/catalog/events/${eventId}`);
  return acceptedOperationState(previous, resolveParticipationSetNotice(status));
}

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

/** Declines an invitation as its invitee (Issue #36). */
export async function declineInvitationAction(
  previous: OperationState,
  formData: FormData,
): Promise<OperationState> {
  const invitationId = readId(formData, 'invitationId');
  if (invitationId === null) {
    return rejectedOperationState(
      previous,
      resolveOperationFeedback('decline-invitation', 'failure'),
    );
  }

  const client = await createSupabaseServerClient();
  const result = await declineInvitation(client, invitationId);
  if (!result.ok) {
    return rejectedOperationState(
      previous,
      resolveOperationFeedback('decline-invitation', result.error.kind),
    );
  }

  revalidatePath('/catalog/invitations');
  return acceptedOperationState(previous, resolveOperationNotice('decline-invitation'));
}
