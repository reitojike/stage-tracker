'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/Sheet';
import { StatePanel } from '@/ui/StatePanel';
import { INITIAL_WRITE_FORM_STATE } from '@/domain/eventWriteFeedback.ts';
import type { RawFormValues } from '@/domain/eventCatalogWrite.ts';
import { updateEventRangeAction } from '../_actions/eventWrite.ts';
import { EventRangeFields } from './EventRangeFields.tsx';
import { WriteNotice } from '@/ui/WriteNotice';
import styles from './EventWriteForm.module.css';

export interface EventRangeEditFormProps {
  eventId: string;
  initialValues: RawFormValues;
}

/**
 * Edits an event's Event range (Issue #87/#88). Submits through
 * updateEventRangeAction, which carries every existing occurrence through
 * the reschedule_event RPC unchanged - so widening or narrowing the range
 * here succeeds exactly when the result would still contain every
 * occurrence's current time, the same rule a genuine reschedule (moving
 * occurrences too, via OccurrenceUpdateForm below) has to satisfy once it
 * is done.
 */
export function EventRangeEditForm({ eventId, initialValues }: EventRangeEditFormProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(updateEventRangeAction, {
    ...INITIAL_WRITE_FORM_STATE,
    values: initialValues,
  });
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
        変更
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="開催期間"
        showCloseButton={false}
        footer={
          <div className={styles.sheetFooter}>
            <Button type="submit" form="event-range-edit" disabled={isPending}>
              <span className={styles.stablePendingLabel}>
                <span aria-hidden="true" className={styles.stablePendingSizing}>
                  開催期間を保存
                </span>
                <span>{isPending ? '保存中…' : '開催期間を保存'}</span>
              </span>
            </Button>
          </div>
        }
      >
        <form
          id="event-range-edit"
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
          <p className={styles.sectionDescription}>
            開催期間と公演回の日時を両方とも新しい期間へ移す場合は、まず開催期間を広げてから公演回の日時を編集し、最後に開催期間を正しい範囲へ戻してください。
          </p>
          <div key={state.attempt} className={styles.fields}>
            <EventRangeFields
              values={state.values}
              fieldErrors={state.fieldErrors}
              disabled={isPending}
            />
          </div>
        </form>
      </Sheet>
    </>
  );
}
