'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/Sheet';
import { StatePanel } from '@/ui/StatePanel';
import { INITIAL_SCHEDULE_ENTRY_DELETE_FORM_STATE } from '@/domain/personalScheduleWriteFeedback.ts';
import { deleteScheduleEntryAction } from '../_actions/scheduleWrite.ts';
import styles from './ScheduleWriteForm.module.css';

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
 * Confirms before submitting via a confirmation Sheet: unlike every
 * other write this feature offers, this one is irreversible (no soft
 * delete/trash/restore - product-rules.md "Entry deletion semantics") and
 * its blast radius extends beyond the owner - every share recipient loses
 * the entry too, via the DB-level ON DELETE CASCADE on personal_schedule_shares.
 */
export function DeleteEntryForm({ entryId }: DeleteEntryFormProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(
    deleteScheduleEntryAction,
    INITIAL_SCHEDULE_ENTRY_DELETE_FORM_STATE,
  );

  return (
    <>
      <form id="delete-schedule-entry-form" action={formAction} aria-busy={isPending}>
        <input type="hidden" name="entryId" value={entryId} />

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
          削除
        </Button>
      </form>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="削除"
        showCloseButton={false}
        footer={
          <div>
            <Button
              type="submit"
              form="delete-schedule-entry-form"
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
