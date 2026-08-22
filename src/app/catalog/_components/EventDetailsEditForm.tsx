'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { INITIAL_WRITE_FORM_STATE } from '@/domain/eventWriteFeedback.ts';
import type { RawFormValues } from '@/domain/eventCatalogWrite.ts';
import { updateEventDetailsAction } from '../_actions/eventWrite.ts';
import { EventFields } from './EventFields.tsx';
import styles from './EventWriteForm.module.css';

export interface EventDetailsEditFormProps {
  eventId: string;
  /** The event's persisted values, used until a rejected submission
   * replaces them with what the owner actually typed. */
  initialValues: RawFormValues;
}

/**
 * Updates an event's descriptive fields (Issue #29). Ownership is not
 * transferable and every system-managed field is read-only, so neither is
 * offered here; the corresponding columns carry no UPDATE grant either.
 *
 * The event id travels in a hidden input. That is not a security boundary
 * - RLS is - so a tampered id produces an honest permission denial rather
 * than an edit of someone else's event.
 */
export function EventDetailsEditForm({ eventId, initialValues }: EventDetailsEditFormProps) {
  const [state, formAction, isPending] = useActionState(updateEventDetailsAction, {
    ...INITIAL_WRITE_FORM_STATE,
    values: initialValues,
  });

  return (
    <form action={formAction} className={styles.form} aria-busy={isPending}>
      <input type="hidden" name="eventId" value={eventId} />

      {state.feedback ? (
        <StatePanel
          variant={state.feedback.variant}
          title={state.feedback.title}
          description={state.feedback.description}
        />
      ) : null}

      {/* role="status" rather than an alert: a completed save is
          confirmation, not something demanding attention. */}
      {state.notice ? (
        <p role="status" className={styles.notice}>
          {state.notice}
        </p>
      ) : null}

      <div key={state.attempt} className={styles.fields}>
        <EventFields values={state.values} fieldErrors={state.fieldErrors} disabled={isPending} />
      </div>

      <div className={styles.actions}>
        <Button type="submit" disabled={isPending}>
          {isPending ? '保存中…' : 'イベント情報を保存'}
        </Button>
      </div>
    </form>
  );
}
