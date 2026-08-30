'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { INITIAL_EVENT_CANCELLATION_FORM_STATE } from '@/domain/eventWriteFeedback.ts';
import { cancelEventAction, uncancelEventAction } from '../_actions/eventWrite.ts';
import { WriteNotice } from './WriteNotice.tsx';

export interface EventCancellationFormProps {
  eventId: string;
  isCanceled: boolean;
}

const CANCEL_CONFIRM_MESSAGE =
  'このイベントを中止にします。既存の参加予定・招待情報は削除されません。よろしいですか？';
const UNCANCEL_CONFIRM_MESSAGE = 'このイベントの中止を解除します。よろしいですか？';

/**
 * Owner-only Event-level cancel/uncancel toggle (Issue #125/#123). Never
 * rendered for a non-owner - the edit page only mounts this inside its
 * isOwner branch - though RLS (the events_update_own policy's owner-only
 * WITH CHECK) is the actual boundary. Unlike DeleteEventForm, this is
 * reversible (uncancel corrects a mistaken cancel), so the confirmation
 * wording does not claim otherwise.
 *
 * A single component rather than two forms that both stay mounted: which
 * action applies is a function of the event's own current state, so
 * rendering both at once would let a stale action fire against state that
 * already changed underneath it.
 */
export function EventCancellationForm({ eventId, isCanceled }: EventCancellationFormProps) {
  const [state, formAction, isPending] = useActionState(
    isCanceled ? uncancelEventAction : cancelEventAction,
    INITIAL_EVENT_CANCELLATION_FORM_STATE,
  );

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

      {state.feedback ? (
        <StatePanel
          key={state.attempt}
          variant={state.feedback.variant}
          title={state.feedback.title}
          description={state.feedback.description}
        />
      ) : null}
      <WriteNotice notice={state.notice} attempt={state.attempt} />

      <Button type="submit" variant="secondary" disabled={isPending}>
        {isPending ? '処理中…' : isCanceled ? 'このイベントの中止を解除' : 'このイベントを中止'}
      </Button>
    </form>
  );
}
