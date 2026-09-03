'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/Sheet';
import { INITIAL_EVENT_DELETE_FORM_STATE } from '@/domain/eventWriteFeedback.ts';
import { deleteEventOccurrenceAction } from '../_actions/eventWrite.ts';
import styles from './EventWriteForm.module.css';

export interface DeleteOccurrenceFormProps {
  eventId: string;
  occurrenceId: string;
  formAction: (formData: FormData) => void;
  isPending: boolean;
}

const CONFIRM_MESSAGE = 'この公演回を削除します。削除すると元に戻せません。よろしいですか？';

/**
 * Owner-only hard delete for an event occurrence (Issue #124). Never
 * rendered for a non-owner - the edit page only mounts this inside its
 * isOwner branch - though RLS (delete_event_occurrence RPC's SECURITY
 * DEFINER check) is the actual boundary. Uses a confirmation Sheet since
 * deletion is irreversible (no soft delete/trash/restore per
 * product-rules.md "Deletion"). The action state is created by the
 * surrounding OccurrenceUpdateForm so any feedback can be placed above the
 * lifecycle button row without changing this form's semantics.
 */
export function useDeleteOccurrenceAction() {
  return useActionState(deleteEventOccurrenceAction, INITIAL_EVENT_DELETE_FORM_STATE);
}

export function DeleteOccurrenceForm({
  eventId,
  occurrenceId,
  formAction,
  isPending,
}: DeleteOccurrenceFormProps) {
  const [open, setOpen] = useState(false);
  const formId = `delete-occurrence-${occurrenceId}`;
  return (
    <>
      <form id={formId} action={formAction} aria-busy={isPending}>
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="occurrenceId" value={occurrenceId} />

        <Button
          type="button"
          variant="danger"
          disabled={isPending}
          aria-label="この公演回を削除"
          onClick={() => {
            setOpen(true);
          }}
        >
          削除する
        </Button>
      </form>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="この公演回を削除"
        showCloseButton={false}
        footer={
          <div className={styles.sheetFooter}>
            <Button type="submit" form={formId} variant="danger" disabled={isPending}>
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
