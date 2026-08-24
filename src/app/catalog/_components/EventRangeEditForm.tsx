'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { INITIAL_WRITE_FORM_STATE } from '@/domain/eventWriteFeedback.ts';
import type { RawFormValues } from '@/domain/eventCatalogWrite.ts';
import { updateEventRangeAction } from '../_actions/eventWrite.ts';
import { EventRangeFields } from './EventRangeFields.tsx';
import { WriteNotice } from './WriteNotice.tsx';
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
  const [state, formAction, isPending] = useActionState(updateEventRangeAction, {
    ...INITIAL_WRITE_FORM_STATE,
    values: initialValues,
  });

  return (
    <form action={formAction} className={styles.form} aria-busy={isPending}>
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
        <EventRangeFields
          values={state.values}
          fieldErrors={state.fieldErrors}
          disabled={isPending}
        />
      </div>

      <div className={styles.actions}>
        <Button type="submit" disabled={isPending}>
          {isPending ? '保存中…' : '開催期間を保存'}
        </Button>
      </div>
    </form>
  );
}
