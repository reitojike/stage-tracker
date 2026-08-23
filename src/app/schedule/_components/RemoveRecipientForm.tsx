'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { INITIAL_SHARE_REMOVE_FORM_STATE } from '@/domain/personalScheduleWriteFeedback.ts';
import { removeScheduleShareAsOwnerAction } from '../_actions/scheduleWrite.ts';

export interface RemoveRecipientFormProps {
  entryId: string;
  shareId: string;
  recipientEmail: string;
}

/**
 * Lets the entry's owner remove one recipient's share, identified by the
 * exact email #55's list_schedule_share_recipient_emails projection
 * returned for it (Issue #37). This posts the same shareId the owner was
 * shown for this row - never a value picked by inference (see
 * findOwnScheduleShare's comment in domain/personalSchedule.ts for why
 * that distinction matters).
 */
export function RemoveRecipientForm({
  entryId,
  shareId,
  recipientEmail,
}: RemoveRecipientFormProps) {
  const [state, formAction, isPending] = useActionState(
    removeScheduleShareAsOwnerAction,
    INITIAL_SHARE_REMOVE_FORM_STATE,
  );

  return (
    <form action={formAction} aria-busy={isPending}>
      <input type="hidden" name="shareId" value={shareId} />
      <input type="hidden" name="entryId" value={entryId} />

      {state.feedback ? (
        <StatePanel
          key={state.attempt}
          variant={state.feedback.variant}
          title={state.feedback.title}
          description={state.feedback.description}
        />
      ) : null}

      <Button type="submit" variant="secondary" disabled={isPending}>
        {isPending ? '削除中…' : `${recipientEmail} の共有を解除`}
      </Button>
    </form>
  );
}
