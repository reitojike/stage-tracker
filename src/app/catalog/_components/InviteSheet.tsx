'use client';

import { useActionState, useEffect } from 'react';
import { Sheet } from '@/ui/Sheet';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { TextInput } from '@/ui/TextInput';
import { INITIAL_OPERATION_STATE } from '@/domain/participationFeedback.ts';
import { occurrenceTimeRangeLabel, tokyoDateLabel } from '@/domain/catalogFormatting.ts';
import { inviteToOccurrenceAction } from '../_actions/participationWrite.ts';
import { WriteNotice } from './WriteNotice.tsx';
import styles from './InviteSheet.module.css';

export interface InviteSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  occurrenceId: string;
  occurrence: { startsAt: string; endsAt: string | null };
}

/**
 * Event detail "招待する" bottom sheet (Issue #230 addendum), reusing the
 * shared src/ui/Sheet.tsx primitive and the existing
 * inviteToOccurrenceAction/parseInviteeEmail write path verbatim (Issue #55:
 * exact registered email only, no directory/search; opacity preserved - see
 * that action's own header comment). Only the presentation moved into the
 * sheet; invite eligibility, targeting, and opacity are unchanged.
 */
export function InviteSheet({
  open,
  onOpenChange,
  eventId,
  occurrenceId,
  occurrence,
}: InviteSheetProps) {
  const [state, formAction, isPending] = useActionState(
    inviteToOccurrenceAction,
    INITIAL_OPERATION_STATE,
  );

  // A successful submission (notice set, no feedback) closes the sheet -
  // the addendum shows one execution button per sheet, not a persistent
  // "sent invitees" surface to keep open afterward. Closing an
  // already-closed sheet is a harmless no-op, so including onOpenChange in
  // the dependency array (it is a new closure on every parent render) never
  // causes an incorrect re-fire.
  useEffect(() => {
    if (state.notice !== null) {
      onOpenChange(false);
    }
  }, [state.attempt, state.notice, onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="招待する">
      <p className={styles.occurrenceTime}>
        {tokyoDateLabel(occurrence.startsAt)}{' '}
        {occurrenceTimeRangeLabel(occurrence.startsAt, occurrence.endsAt)}
      </p>

      <form action={formAction} className={styles.form} aria-busy={isPending}>
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="occurrenceId" value={occurrenceId} />

        {state.feedback ? (
          <StatePanel
            key={state.attempt}
            variant={state.feedback.variant}
            title={state.feedback.title}
            description={state.feedback.description}
          />
        ) : null}
        <WriteNotice notice={state.notice} attempt={state.attempt} />

        <TextInput
          key={state.attempt}
          label="招待するユーザーの登録メールアドレス"
          name="email"
          type="email"
          required
          disabled={isPending}
          defaultValue={state.values.email ?? ''}
          error={state.fieldError ?? undefined}
          helperText="Stage Trackerに登録済みのメールアドレスを入力してください。"
        />

        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={isPending}>
            {isPending ? '送信中…' : '招待する'}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
