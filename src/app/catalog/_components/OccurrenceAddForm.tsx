'use client';

import { useActionState } from 'react';
import { ActionRow } from '@/ui/ActionRow';
import { Button } from '@/ui/Button';
import { FormSection } from '@/ui/FormSection';
import { StatePanel } from '@/ui/StatePanel';
import { INITIAL_WRITE_FORM_STATE } from '@/domain/eventWriteFeedback.ts';
import { addOccurrenceAction } from '../_actions/eventWrite.ts';
import { OccurrenceFields } from './OccurrenceFields.tsx';
import { WriteNotice } from './WriteNotice.tsx';
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

      {/* Keyed by `attempt` for the same reason WriteNotice keys its message:
          resolveWriteFeedback returns module-level constants, so a second
          identical failure would re-render StatePanel with referentially
          identical props and commit no DOM mutation, leaving the retry
          silent. StatePanel's own role="alert" is announced on insertion,
          so replacing the node is what makes the retry audible. */}
      {state.feedback ? (
        <StatePanel
          key={state.attempt}
          variant={state.feedback.variant}
          title={state.feedback.title}
          description={state.feedback.description}
        />
      ) : null}

      <WriteNotice notice={state.notice} attempt={state.attempt} />

      <FormSection key={state.attempt} as="fieldset" heading="公演回を追加">
        <OccurrenceFields
          values={state.values}
          fieldErrors={state.fieldErrors}
          disabled={isPending}
        />
        <ActionRow>
          <Button type="submit" disabled={isPending}>
            {isPending ? '追加中…' : '公演回を追加'}
          </Button>
        </ActionRow>
      </FormSection>
    </form>
  );
}
