'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { INITIAL_SCHEDULE_ENTRY_DELETE_FORM_STATE } from '@/domain/personalScheduleWriteFeedback.ts';
import { deleteScheduleEntryAction } from '../_actions/scheduleWrite.ts';

export interface DeleteEntryFormProps {
  entryId: string;
}

const CONFIRM_MESSAGE =
  'この予定を削除します。削除すると元に戻せません。共有相手からもこの予定が見えなくなります。よろしいですか？';

/**
 * Owner-only hard delete for a personal schedule entry (Issue #121). Never
 * rendered for a shared recipient - [entryId]/page.tsx only mounts this
 * inside its isOwner branch - though RLS (personal_schedule_entries_
 * delete_own) is the actual boundary, not this component.
 *
 * Confirms before submitting via a native confirm() dialog: unlike every
 * other write this feature offers, this one is irreversible (no soft
 * delete/trash/restore - product-rules.md "Entry deletion semantics") and
 * its blast radius extends beyond the owner - every share recipient loses
 * the entry too, via the DB-level ON DELETE CASCADE on personal_schedule_
 * shares. Calling preventDefault() in onSubmit when the caller cancels
 * stops the native form submission that would otherwise invoke formAction
 * (React server actions ride the same submit event a plain <form> would).
 */
export function DeleteEntryForm({ entryId }: DeleteEntryFormProps) {
  const [state, formAction, isPending] = useActionState(
    deleteScheduleEntryAction,
    INITIAL_SCHEDULE_ENTRY_DELETE_FORM_STATE,
  );

  return (
    <form
      action={formAction}
      aria-busy={isPending}
      onSubmit={(event) => {
        if (!window.confirm(CONFIRM_MESSAGE)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="entryId" value={entryId} />

      {state.feedback ? (
        <StatePanel
          key={state.attempt}
          variant={state.feedback.variant}
          title={state.feedback.title}
          description={state.feedback.description}
        />
      ) : null}

      <Button type="submit" variant="danger" disabled={isPending}>
        {isPending ? '削除中…' : '削除'}
      </Button>
    </form>
  );
}
