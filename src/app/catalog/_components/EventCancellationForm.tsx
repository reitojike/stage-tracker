'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { INITIAL_EVENT_CANCELLATION_FORM_STATE } from '@/domain/eventWriteFeedback.ts';
import { cancelEventAction, uncancelEventAction } from '../_actions/eventWrite.ts';
import { WriteNotice } from '@/ui/WriteNotice';
import styles from './EventWriteForm.module.css';

export interface EventCancellationFormProps {
  eventId: string;
  isCanceled: boolean;
}

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
    <form action={formAction} aria-busy={isPending}>
      <input type="hidden" name="eventId" value={eventId} />

      <WriteNotice notice={state.notice} attempt={state.attempt} />
      {state.feedback ? (
        <StatePanel
          key={state.attempt}
          variant={state.feedback.variant}
          title={state.feedback.title}
          description={state.feedback.description}
        />
      ) : null}
      <Button type="submit" variant="secondary" disabled={isPending}>
        <span className={styles.stablePendingLabel}>
          <span aria-hidden="true" className={styles.stablePendingSizing}>
            このイベントの中止を解除
          </span>
          <span>
            {isPending
              ? isCanceled
                ? '解除中…'
                : '中止中…'
              : isCanceled
                ? 'このイベントの中止を解除'
                : 'このイベントを中止'}
          </span>
        </span>
      </Button>
    </form>
  );
}
