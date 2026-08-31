'use client';

import { StatePanel } from '@/ui/StatePanel';
import { TextInput } from '@/ui/TextInput';
import type { ScheduleShareAddFormState } from '@/domain/personalScheduleWriteFeedback.ts';
import { ScheduleWriteNotice } from './ScheduleWriteNotice.tsx';
import styles from './ShareAddForm.module.css';

export interface ShareAddFormProps {
  entryId: string;
  formId: string;
  formAction: (formData: FormData) => void;
  state: ScheduleShareAddFormState;
  isPending: boolean;
}

/**
 * Lets the entry's owner add a recipient by their exact registered email
 * (Issue #37, over #55's shareScheduleEntryByEmail RPC). MVP targeting is
 * exact email input only - no autocomplete, no user directory/search, and
 * no raw user id ever reaches this form; share_schedule_entry_by_email
 * resolves the email to a user id server-side and is the only thing that
 * decides whether it belongs to a registered account.
 */
export function ShareAddForm({ entryId, formId, formAction, state, isPending }: ShareAddFormProps) {
  return (
    <form
      id={formId}
      action={formAction}
      className={styles.form}
      aria-label="共有相手を追加"
      aria-busy={isPending}
    >
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
          label="共有相手のメールアドレス"
          name="email"
          type="email"
          required
          defaultValue={state.email}
          error={state.fieldError ?? undefined}
          disabled={isPending}
          helperText="stage-trackerに登録済みのメールアドレスを、正確に入力してください。"
        />
      </div>
    </form>
  );
}
