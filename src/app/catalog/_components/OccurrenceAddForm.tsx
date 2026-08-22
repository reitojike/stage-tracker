'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { INITIAL_WRITE_FORM_STATE } from '@/domain/eventWriteFeedback.ts';
import { addOccurrenceAction } from '../_actions/eventWrite.ts';
import { OccurrenceFields } from './OccurrenceFields.tsx';
import styles from './EventWriteForm.module.css';

export interface OccurrenceAddFormProps {
  eventId: string;
}

/**
 * Adds a further 公演回 to an existing event (Issue #29). Multiple
 * performances on the same day are simply multiple occurrences, so nothing
 * here caps or de-duplicates by date - that would impose a rule the
 * product does not have.
 */
export function OccurrenceAddForm({ eventId }: OccurrenceAddFormProps) {
  const [state, formAction, isPending] = useActionState(
    addOccurrenceAction,
    INITIAL_WRITE_FORM_STATE,
  );

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

      <fieldset key={state.attempt} className={styles.group}>
        <legend className={styles.groupLegend}>公演回を追加</legend>
        <OccurrenceFields
          values={state.values}
          fieldErrors={state.fieldErrors}
          disabled={isPending}
        />
        <div className={styles.actions}>
          <Button type="submit" disabled={isPending}>
            {isPending ? '追加中…' : '公演回を追加'}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
