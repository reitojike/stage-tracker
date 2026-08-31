'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/Sheet';
import { StatePanel } from '@/ui/StatePanel';
import { INITIAL_WRITE_FORM_STATE } from '@/domain/eventWriteFeedback.ts';
import { addOccurrenceAction } from '../_actions/eventWrite.ts';
import { OccurrenceFields } from './OccurrenceFields.tsx';
import { WriteNotice } from '@/ui/WriteNotice';
import styles from './EventWriteForm.module.css';

export interface OccurrenceAddFormProps {
  eventId: string;
}

/** Adds an occurrence through the same bottom-sheet vocabulary as editing
 * one, while retaining the existing add_occurrence server action. */
export function OccurrenceAddForm({ eventId }: OccurrenceAddFormProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(
    addOccurrenceAction,
    INITIAL_WRITE_FORM_STATE,
  );
  const closedAttemptRef = useRef<number | null>(null);

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
        onClick={() => {
          setOpen(true);
        }}
      >
        ＋ 追加
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="公演回を追加"
        showCloseButton={false}
        footer={
          <div className={styles.sheetFooter}>
            <Button
              type="submit"
              form="occurrence-add"
              className={styles.stablePendingButton}
              disabled={isPending}
            >
              <span className={styles.stablePendingLabel}>
                <span aria-hidden="true" className={styles.stablePendingSizing}>
                  公演回を追加
                </span>
                <span>{isPending ? '追加中…' : '公演回を追加'}</span>
              </span>
            </Button>
          </div>
        }
      >
        <form
          id="occurrence-add"
          action={formAction}
          className={styles.sheetForm}
          aria-busy={isPending}
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
          <div key={state.attempt} className={styles.fields}>
            <OccurrenceFields
              values={state.values}
              fieldErrors={state.fieldErrors}
              disabled={isPending}
              compactHelperText="空欄の開場は未公表、終演は終了時刻未定として扱われます。すべて日本時間（Asia/Tokyo）です。"
            />
          </div>
        </form>
      </Sheet>
    </>
  );
}
