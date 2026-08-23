'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { INITIAL_SCHEDULE_WRITE_FORM_STATE } from '@/domain/personalScheduleWriteFeedback.ts';
import { createScheduleEntryAction } from '../_actions/scheduleWrite.ts';
import { ScheduleFields } from './ScheduleFields.tsx';
import styles from './ScheduleWriteForm.module.css';

/**
 * Creates a personal schedule entry (Issue #37). Makes no permission
 * decision itself: any authenticated user may create their own entry
 * (personal_schedule_entries_insert_own RLS), so unlike the Event create
 * form this needs no gating page above it - reachability alone
 * (src/proxy.ts) is enough.
 */
export function ScheduleEntryCreateForm() {
  const [state, formAction, isPending] = useActionState(
    createScheduleEntryAction,
    INITIAL_SCHEDULE_WRITE_FORM_STATE,
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

      <div className={styles.actions}>
        <Button type="submit" disabled={isPending}>
          {isPending ? '作成中…' : '予定を作成'}
        </Button>
      </div>
    </form>
  );
}
