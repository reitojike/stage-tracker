'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { Sheet } from '@/ui/Sheet';
import { INITIAL_EVENT_DELETE_FORM_STATE } from '@/domain/eventWriteFeedback.ts';
import { deleteEventAction } from '../_actions/eventWrite.ts';
import styles from './EventWriteForm.module.css';

export interface DeleteEventFormProps {
  eventId: string;
}

const CONFIRM_MESSAGE =
  'このイベントとすべての公演回を削除します。削除すると元に戻せません。よろしいですか？';

/**
 * Owner-only hard delete for an event and all its child occurrences
 * (Issue #124). Never rendered for a non-owner - the edit page only
 * mounts this inside its isOwner branch - though RLS (delete_event RPC's
 * SECURITY DEFINER check) is the actual boundary. Uses a confirmation
 * Sheet since deletion is irreversible.
 *
 * On success redirects to /catalog (the deleted event's detail page no
 * longer exists). On blocked-delete or permission-denied, returns feedback
 * to the user.
 */
export function DeleteEventForm({ eventId }: DeleteEventFormProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(
    deleteEventAction,
    INITIAL_EVENT_DELETE_FORM_STATE,
  );

  return (
    <>
      <form id="delete-event-form" action={formAction} aria-busy={isPending}>
        <input type="hidden" name="eventId" value={eventId} />

        {state.feedback ? (
          <StatePanel
            key={state.attempt}
            variant={state.feedback.variant}
            title={state.feedback.title}
            description={state.feedback.description}
          />
        ) : null}

        <Button
          type="button"
          variant="danger"
          disabled={isPending}
          onClick={() => {
            setOpen(true);
          }}
        >
          このイベントを削除
        </Button>
      </form>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="このイベントを削除"
        showCloseButton={false}
        footer={
          <div className={styles.sheetFooter}>
            <Button
              type="submit"
              form="delete-event-form"
              variant="danger"
              className={styles.stablePendingButton}
              disabled={isPending}
            >
              <span className={styles.stablePendingLabel}>
                <span aria-hidden="true" className={styles.stablePendingSizing}>
                  削除中…
                </span>
                <span>{isPending ? '削除中…' : '削除'}</span>
              </span>
            </Button>
          </div>
        }
      >
        {CONFIRM_MESSAGE}
      </Sheet>
    </>
  );
}
