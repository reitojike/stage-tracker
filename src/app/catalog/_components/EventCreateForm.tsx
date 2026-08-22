'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { INITIAL_WRITE_FORM_STATE } from '@/domain/eventWriteFeedback.ts';
import type { CatalogParams } from '@/domain/catalogNavigation.ts';
import { createEventAction } from '../_actions/eventWrite.ts';
import { EventFields } from './EventFields.tsx';
import { OccurrenceFields } from './OccurrenceFields.tsx';
import styles from './EventWriteForm.module.css';

/**
 * Creates an event together with its required initial occurrence (Issue
 * #29). The two halves are submitted as one form because they are
 * persisted as one atomic operation - there is no supported path that
 * creates an event without an occurrence, so the UI does not offer one.
 *
 * This component renders only what the write boundary supports. It makes
 * no permission decision: the page above it decides whether to render this
 * form at all, and the database decides whether the submission persists.
 */
export interface EventCreateFormProps {
  /** The month/day the user was browsing. Carried through the submission so
   * a completed create lands on the new event with the same calendar
   * context the surrounding screens navigate with. */
  context: CatalogParams;
}

export function EventCreateForm({ context }: EventCreateFormProps) {
  const [state, formAction, isPending] = useActionState(
    createEventAction,
    INITIAL_WRITE_FORM_STATE,
  );

  return (
    <form action={formAction} className={styles.form} aria-busy={isPending}>
      <input type="hidden" name="month" value={context.yearMonth} />
      {context.selectedDate !== null ? (
        <input type="hidden" name="date" value={context.selectedDate} />
      ) : null}

      {state.feedback ? (
        <StatePanel
          variant={state.feedback.variant}
          title={state.feedback.title}
          description={state.feedback.description}
        />
      ) : null}

      {/* Remount key: an already-mounted uncontrolled input ignores a
          changed defaultValue, so without this a rejected submission would
          re-render with the previous attempt's values still in the DOM. */}
      <div key={state.attempt} className={styles.fields}>
        <EventFields values={state.values} fieldErrors={state.fieldErrors} disabled={isPending} />

        <fieldset className={styles.group}>
          <legend className={styles.groupLegend}>初回公演回</legend>
          <OccurrenceFields
            values={state.values}
            fieldErrors={state.fieldErrors}
            disabled={isPending}
            startsAtHelperText="日本時間（Asia/Tokyo）で入力します。公演回は作成後に追加できます。"
          />
        </fieldset>
      </div>

      <div className={styles.actions}>
        <Button type="submit" disabled={isPending}>
          {isPending ? '作成中…' : 'イベントを作成'}
        </Button>
      </div>
    </form>
  );
}
