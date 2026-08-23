'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { TextInput } from '@/ui/TextInput';
import { INITIAL_SHARE_ADD_FORM_STATE } from '@/domain/personalScheduleWriteFeedback.ts';
import { addScheduleShareByEmailAction } from '../_actions/scheduleWrite.ts';
import { ScheduleWriteNotice } from './ScheduleWriteNotice.tsx';
import styles from './ScheduleWriteForm.module.css';

export interface ShareAddFormProps {
  entryId: string;
}

/**
 * Lets the entry's owner add a recipient by their exact registered email
 * (Issue #37, over #55's shareScheduleEntryByEmail RPC). MVP targeting is
 * exact email input only - no autocomplete, no user directory/search, and
 * no raw user id ever reaches this form; share_schedule_entry_by_email
 * resolves the email to a user id server-side and is the only thing that
 * decides whether it belongs to a registered account.
 */
export function ShareAddForm({ entryId }: ShareAddFormProps) {
  const [state, formAction, isPending] = useActionState(
    addScheduleShareByEmailAction,
    INITIAL_SHARE_ADD_FORM_STATE,
  );

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

      <ScheduleWriteNotice notice={state.notice} attempt={state.attempt} />

      <div key={state.attempt} className={styles.fields}>
        <TextInput
          label="登録済みメールアドレス"
          name="email"
          type="email"
          required
          defaultValue={state.email}
          error={state.fieldError ?? undefined}
          disabled={isPending}
          helperText="stage-trackerに登録済みのメールアドレスを、正確に入力してください。"
        />
      </div>

      <div className={styles.actions}>
        <Button type="submit" disabled={isPending}>
          {isPending ? '追加中…' : 'recipientを追加'}
        </Button>
      </div>
    </form>
  );
}
