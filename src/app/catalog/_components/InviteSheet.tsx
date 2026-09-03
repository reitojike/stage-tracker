'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Sheet } from '@/ui/Sheet';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { TextInput } from '@/ui/TextInput';
import { INITIAL_OPERATION_STATE } from '@/domain/participationFeedback.ts';
import { occurrenceTimeRangeLabel, tokyoDateLabel } from '@/domain/catalogFormatting.ts';
import { inviteToOccurrenceAction } from '../_actions/participationWrite.ts';
import { WriteNotice } from '@/ui/WriteNotice';
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
  const formId = `invite-${occurrenceId}`;

  // A successful submission (notice set, no feedback) closes the sheet -
  // the addendum shows one execution button per sheet, not a persistent
  // "sent invitees" surface to keep open afterward. This component stays
  // mounted across opens/closes (OccurrenceParticipationRow only toggles
  // `open`), and useActionState's `state` persists with it - so without
  // tracking which `attempt` was already handled, this effect would re-fire
  // on every re-render after the first success (onOpenChange is a fresh
  // closure each render) and immediately close the sheet the next time it's
  // opened, before the user could submit again (caught in review on #230).
  const closedAttemptRef = useRef<number | null>(null);
  useEffect(() => {
    if (state.notice !== null && closedAttemptRef.current !== state.attempt) {
      closedAttemptRef.current = state.attempt;
      onOpenChange(false);
    }
  }, [state.attempt, state.notice, onOpenChange]);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="招待する"
      showCloseButton={false}
      footer={
        <div className={styles.footer}>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={isPending}
            aria-label={isPending ? '招待を送信中…' : '招待する'}
          >
            <span className={styles.stablePendingLabel}>
              <span aria-hidden="true" className={styles.stablePendingSizing}>
                招待する
              </span>
              <span>{isPending ? '送信中…' : '招待する'}</span>
            </span>
          </Button>
        </div>
      }
    >
      <WriteNotice notice={state.notice} attempt={state.attempt} />
      <p className={styles.occurrenceTime}>
        {tokyoDateLabel(occurrence.startsAt)}{' '}
        {occurrenceTimeRangeLabel(occurrence.startsAt, occurrence.endsAt)}
      </p>

      <form id={formId} action={formAction} className={styles.form} aria-busy={isPending}>
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
        <TextInput
          key={state.attempt}
          label="招待するユーザーの登録メールアドレス"
          labelClassName={styles.emailLabel}
          name="email"
          type="email"
          required
          disabled={isPending}
          defaultValue={state.values.email ?? ''}
          error={state.fieldError ?? undefined}
          helperText="Stage Trackerに登録済みのメールアドレスを入力してください。"
        />
      </form>
    </Sheet>
  );
}
