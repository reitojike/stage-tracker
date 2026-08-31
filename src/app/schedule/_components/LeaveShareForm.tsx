'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { INITIAL_SHARE_REMOVE_FORM_STATE } from '@/domain/personalScheduleWriteFeedback.ts';
import { removeScheduleShareAction } from '../_actions/scheduleWrite.ts';

export interface LeaveShareFormProps {
  /** The caller's own share row id (personal_schedule_shares_select_owner_
   * or_recipient scopes a recipient's read to exactly their own row - see
   * infrastructure/supabase/personalSchedule.ts's listScheduleShares). */
  shareId: string;
}

/**
 * Lets a shared recipient remove themselves from an entry's share list
 * (Issue #37 "shared user self-remove"). This needs no recipient
 * identification: the caller already knows only their own share id, unlike
 * owner-side recipient add/remove (ShareAddForm.tsx / RemoveRecipientForm.tsx),
 * which targets a specific recipient by exact email over #55's boundary.
 */
export function LeaveShareForm({ shareId }: LeaveShareFormProps) {
  const [state, formAction, isPending] = useActionState(
    removeScheduleShareAction,
    INITIAL_SHARE_REMOVE_FORM_STATE,
  );

  return (
    <form action={formAction} aria-busy={isPending}>
      <input type="hidden" name="shareId" value={shareId} />

      {state.feedback ? (
        <StatePanel
          key={state.attempt}
          variant={state.feedback.variant}
          title={state.feedback.title}
          description={state.feedback.description}
        />
      ) : null}

      <Button type="submit" variant="quiet" disabled={isPending}>
        {isPending ? '処理中…' : 'この予定の共有から外れる'}
      </Button>
    </form>
  );
}
