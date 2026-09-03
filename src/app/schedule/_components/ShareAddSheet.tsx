'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/Sheet';
import { INITIAL_SHARE_ADD_FORM_STATE } from '@/domain/personalScheduleWriteFeedback.ts';
import { addScheduleShareByEmailAction } from '../_actions/scheduleWrite.ts';
import { ShareAddForm } from './ShareAddForm.tsx';
import styles from './ShareAddSheet.module.css';

export interface ShareAddSheetProps {
  entryId: string;
  className?: string;
}

/**
 * Keeps share state visible on the detail page while moving only the exact
 * email input workflow into the shared bottom-sheet vocabulary.
 */
export function ShareAddSheet({ entryId, className }: ShareAddSheetProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(
    addScheduleShareByEmailAction,
    INITIAL_SHARE_ADD_FORM_STATE,
  );
  const closedAttemptRef = useRef<number | null>(null);
  const formId = `share-add-${entryId}`;

  useEffect(() => {
    if (state.notice !== null && closedAttemptRef.current !== state.attempt) {
      closedAttemptRef.current = state.attempt;
      setOpen(false);
    }
  }, [state.attempt, state.notice]);

  return (
    <>
      <Button
        type="button"
        variant="quiet"
        className={className}
        onClick={() => {
          setOpen(true);
        }}
      >
        + 追加
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="共有相手を追加"
        showCloseButton={false}
        bodyClassName={styles.body}
        footer={
          <div className={styles.footer}>
            <Button type="submit" form={formId} disabled={isPending}>
              <span className={styles.stablePendingLabel}>
                <span aria-hidden="true" className={styles.stablePendingSizing}>
                  共有相手を追加
                </span>
                <span>{isPending ? '追加中…' : '共有相手を追加'}</span>
              </span>
            </Button>
          </div>
        }
      >
        <ShareAddForm
          entryId={entryId}
          formId={formId}
          formAction={formAction}
          state={state}
          isPending={isPending}
        />
      </Sheet>
    </>
  );
}
