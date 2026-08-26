'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { INITIAL_EVENT_DELETE_FORM_STATE } from '@/domain/eventWriteFeedback.ts';
import { deleteEventOccurrenceAction } from '../_actions/eventWrite.ts';

export interface DeleteOccurrenceFormProps {
  eventId: string;
  occurrenceId: string;
}

const CONFIRM_MESSAGE = 'この公演回を削除します。削除すると元に戻せません。よろしいですか？';

/**
 * Owner-only hard delete for an event occurrence (Issue #124). Never
 * rendered for a non-owner - the edit page only mounts this inside its
 * isOwner branch - though RLS (delete_event_occurrence RPC's SECURITY
 * DEFINER check) is the actual boundary. Confirms via native confirm()
 * since deletion is irreversible (no soft delete/trash/restore per
 * product-rules.md "Deletion").
 */
export function DeleteOccurrenceForm({ eventId, occurrenceId }: DeleteOccurrenceFormProps) {
  const [state, formAction, isPending] = useActionState(
    deleteEventOccurrenceAction,
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
      <input type="hidden" name="occurrenceId" value={occurrenceId} />

      {state.feedback ? (
        <StatePanel
          key={state.attempt}
          variant={state.feedback.variant}
          title={state.feedback.title}
          description={state.feedback.description}
        />
      ) : null}

      <Button type="submit" variant="danger" disabled={isPending}>
        {isPending ? '削除中…' : 'この公演回を削除'}
      </Button>
    </form>
  );
}
