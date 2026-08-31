'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import { INITIAL_EVENT_CANCELLATION_FORM_STATE } from '@/domain/eventWriteFeedback.ts';
import {
  cancelEventOccurrenceAction,
  uncancelEventOccurrenceAction,
} from '../_actions/eventWrite.ts';

export interface OccurrenceCancellationFormProps {
  eventId: string;
  occurrenceId: string;
  isCanceled: boolean;
  formAction: (formData: FormData) => void;
  isPending: boolean;
}

const CANCEL_CONFIRM_MESSAGE =
  'この公演回を中止にします。既存の参加予定・招待情報は削除されません。よろしいですか？';
const UNCANCEL_CONFIRM_MESSAGE = 'この公演回の中止を解除します。よろしいですか？';

/**
 * Owner-only Occurrence-level cancel/uncancel toggle (Issue #125/#123),
 * independent of the parent Event's own cancellation state - mirrors
 * EventCancellationForm's shape (see that component's header for why one
 * component covers both directions and why a native confirm() is enough
 * for a reversible action). The action state is created by the surrounding
 * OccurrenceUpdateForm so its feedback can be composed above the lifecycle
 * button row without changing the action or confirmation semantics.
 */
export function useOccurrenceCancellationAction(isCanceled: boolean) {
  return useActionState(
    isCanceled ? uncancelEventOccurrenceAction : cancelEventOccurrenceAction,
    INITIAL_EVENT_CANCELLATION_FORM_STATE,
  );
}

export function OccurrenceCancellationForm({
  eventId,
  occurrenceId,
  isCanceled,
  formAction,
  isPending,
}: OccurrenceCancellationFormProps) {
  return (
    <form
      action={formAction}
      aria-busy={isPending}
      onSubmit={(event) => {
        if (!window.confirm(isCanceled ? UNCANCEL_CONFIRM_MESSAGE : CANCEL_CONFIRM_MESSAGE)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="occurrenceId" value={occurrenceId} />

      <Button type="submit" variant="secondary" disabled={isPending}>
        {isPending ? '処理中…' : isCanceled ? 'この公演回の中止を解除' : 'この公演回を中止'}
      </Button>
    </form>
  );
}
