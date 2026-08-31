'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { INITIAL_SCHEDULE_WRITE_FORM_STATE } from '@/domain/personalScheduleWriteFeedback.ts';
import type { RawFormValues } from '@/domain/personalScheduleWrite.ts';
import { updateScheduleEntryAction } from '../_actions/scheduleWrite.ts';
import { ScheduleFields } from './ScheduleFields.tsx';
import { WriteNotice } from '@/ui/WriteNotice';
import styles from './ScheduleWriteForm.module.css';

export interface ScheduleEntryEditFormProps {
  entryId: string;
  /** The entry's persisted values, used until a rejected submission
   * replaces them with what the owner actually typed. */
  initialValues: RawFormValues;
}

/**
 * Updates a personal schedule entry (Issue #37). The entry id travels in a
 * hidden input - not a security boundary (RLS is: personal_schedule_
 * entries_update_own), so a tampered id produces an honest permission
 * denial rather than an edit of someone else's entry. This page only
 * renders for the owner (see [entryId]/edit/page.tsx); a non-owner posting
 * directly is still refused by the database.
 */
export function ScheduleEntryEditForm({ entryId, initialValues }: ScheduleEntryEditFormProps) {
  const [state, formAction, isPending] = useActionState(updateScheduleEntryAction, {
    ...INITIAL_SCHEDULE_WRITE_FORM_STATE,
    values: initialValues,
  });

  return (
    <form action={formAction} className={styles.form} aria-busy={isPending}>
      <input type="hidden" name="entryId" value={entryId} />

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
        <ScheduleFields
          values={state.values}
          fieldErrors={state.fieldErrors}
          disabled={isPending}
        />
      </div>

      <div className={styles.submitBand}>
        <div className={styles.submitInner}>
          <Button type="submit" className={styles.stablePendingButton} disabled={isPending}>
            {isPending ? '保存中…' : '予定を保存'}
          </Button>
        </div>
      </div>
    </form>
  );
}
