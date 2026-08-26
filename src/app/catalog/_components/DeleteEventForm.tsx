'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { INITIAL_EVENT_DELETE_FORM_STATE } from '@/domain/eventWriteFeedback.ts';
import { deleteEventAction } from '../_actions/eventWrite.ts';

export interface DeleteEventFormProps {
  eventId: string;
}

const CONFIRM_MESSAGE =
  'このイベントとすべての公演回を削除します。削除すると元に戻せません。よろしいですか？';

/**
 * Owner-only hard delete for an event and all its child occurrences
 * (Issue #124). Never rendered for a non-owner - the edit page only
 * mounts this inside its isOwner branch - though RLS (delete_event RPC's
 * SECURITY DEFINER check) is the actual boundary. Confirms via native
 * confirm() since deletion is irreversible.
 *
 * On success redirects to /catalog (the deleted event's detail page no
 * longer exists). On blocked-delete or permission-denied, returns feedback
 * to the user.
 */
export function DeleteEventForm({ eventId }: DeleteEventFormProps) {
  const [state, formAction, isPending] = useActionState(
    deleteEventAction,
    INITIAL_EVENT_DELETE_FORM_STATE,
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
      <input type="hidden" name="eventId" value={eventId} />

      {state.feedback ? (
        <StatePanel
          key={state.attempt}
          variant={state.feedback.variant}
          title={state.feedback.title}
          description={state.feedback.description}
        />
      ) : null}

      <Button type="submit" variant="danger" disabled={isPending}>
        {isPending ? '削除中…' : 'このイベントを削除'}
      </Button>
    </form>
  );
}
