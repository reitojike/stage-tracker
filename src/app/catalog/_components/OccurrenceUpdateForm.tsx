'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { INITIAL_WRITE_FORM_STATE } from '@/domain/eventWriteFeedback.ts';
import type { RawFormValues } from '@/domain/eventCatalogWrite.ts';
import { updateOccurrenceAction } from '../_actions/eventWrite.ts';
import { OccurrenceFields } from './OccurrenceFields.tsx';
import styles from './EventWriteForm.module.css';

export interface OccurrenceUpdateFormProps {
  eventId: string;
  occurrenceId: string;
  /** Legend text identifying which occurrence this form edits. */
  label: string;
  initialValues: RawFormValues;
}

/**
 * Updates one existing 公演回's times (Issue #29). Only the times are
 * editable: moving an occurrence to a different event is not a supported
 * operation, and deletion/cancellation is out of scope for this slice, so
 * neither affordance appears here.
 */
export function OccurrenceUpdateForm({
  eventId,
  occurrenceId,
  label,
  initialValues,
}: OccurrenceUpdateFormProps) {
  const [state, formAction, isPending] = useActionState(updateOccurrenceAction, {
    ...INITIAL_WRITE_FORM_STATE,
    values: initialValues,
  });

  return (
    <form action={formAction} className={styles.form} aria-busy={isPending}>
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="occurrenceId" value={occurrenceId} />

      {state.feedback ? (
        <StatePanel
          variant={state.feedback.variant}
          title={state.feedback.title}
          description={state.feedback.description}
        />
      ) : null}

      <fieldset key={state.attempt} className={styles.group}>
        <legend className={styles.groupLegend}>{label}</legend>
        <OccurrenceFields
          values={state.values}
          fieldErrors={state.fieldErrors}
          disabled={isPending}
        />
        <div className={styles.actions}>
          <Button type="submit" variant="secondary" disabled={isPending}>
            {isPending ? '保存中…' : 'この公演回を保存'}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
