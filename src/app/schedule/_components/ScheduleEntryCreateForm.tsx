'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import type { RawFormValues } from '@/domain/personalScheduleWrite.ts';
import { INITIAL_SCHEDULE_WRITE_FORM_STATE } from '@/domain/personalScheduleWriteFeedback.ts';
import { createScheduleEntryAction } from '../_actions/scheduleWrite.ts';
import { ScheduleFields } from './ScheduleFields.tsx';
import styles from './ScheduleWriteForm.module.css';

export interface ScheduleEntryCreateFormProps {
  /** Issue #196: My Calendar's selected-day add action's bounded prefill
   * (see personalScheduleWrite.ts's resolveScheduleCreatePrefill) - the
   * page composes this from the `date` query param and passes it down, so
   * this component itself stays free of Next.js searchParams handling. */
  initialValues?: RawFormValues;
}

/**
 * Creates a personal schedule entry (Issue #37). Makes no permission
 * decision itself: any authenticated user may create their own entry
 * (personal_schedule_entries_insert_own RLS), so unlike the Event create
 * form this needs no gating page above it - reachability alone
 * (src/proxy.ts) is enough.
 */
export function ScheduleEntryCreateForm({ initialValues }: ScheduleEntryCreateFormProps) {
  const [state, formAction, isPending] = useActionState(
    createScheduleEntryAction,
    initialValues === undefined
      ? INITIAL_SCHEDULE_WRITE_FORM_STATE
      : { ...INITIAL_SCHEDULE_WRITE_FORM_STATE, values: initialValues },
  );

  return (
    <form action={formAction} className={styles.form} aria-busy={isPending}>
      {/* Keyed by `attempt` - see EventCreateForm.tsx's identical comment:
          resolveWriteFeedback returns module-level constants, so a second
          identical failure needs a changed key to actually re-mount
          StatePanel and be announced again. */}
      {state.feedback ? (
        <StatePanel
          key={state.attempt}
          variant={state.feedback.variant}
          title={state.feedback.title}
          description={state.feedback.description}
        />
      ) : null}

      <div key={state.attempt} className={styles.fields}>
        <ScheduleFields
          values={state.values}
          fieldErrors={state.fieldErrors}
          disabled={isPending}
        />
      </div>

      <div className={styles.submitBand}>
        <div className={styles.submitInner}>
          <Button type="submit" disabled={isPending}>
            {isPending ? '作成中…' : '予定を作成'}
          </Button>
        </div>
      </div>
    </form>
  );
}
