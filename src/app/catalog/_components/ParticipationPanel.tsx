'use client';

import { useActionState } from 'react';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { TextInput } from '@/ui/TextInput';
import { INITIAL_OPERATION_STATE } from '@/domain/participationFeedback.ts';
import type { Participation } from '@/domain/participation.ts';
import {
  inviteToOccurrenceAction,
  updateParticipationAction,
} from '../_actions/participationWrite.ts';
import { WriteNotice } from './WriteNotice.tsx';
import styles from './ParticipationPanel.module.css';

export interface ParticipationPanelProps {
  eventId: string;
  occurrenceId: string;
  /** The caller's own participation for this occurrence, or null if they
   * have none yet (Issue #36: absence of a row is "not participating" -
   * there is no `not_attending` status to render instead). */
  participation: Participation | null;
}

/**
 * Per-occurrence participation controls and, when the caller is
 * `attending`, the invite-by-email affordance (Issue #36). Two independent
 * <form>s rather than one: participation and invitation are independent
 * product concepts (product-rules.md), and keeping them as separate
 * useActionState instances means a failed invite submission never clobbers
 * the participation status just set, or vice versa.
 *
 * Every status transition here is the caller acting on their own row -
 * this component never sets anyone else's participation, so
 * "invitee本人だけがconsidering→attendingを確定可能" holds simply because
 * there is no other-user path through this UI at all, not because of any
 * check added here (the enforcement is RLS's own user_id = auth.uid()).
 */
export function ParticipationPanel({
  eventId,
  occurrenceId,
  participation,
}: ParticipationPanelProps) {
  const [state, formAction, isPending] = useActionState(
    updateParticipationAction,
    INITIAL_OPERATION_STATE,
  );
  const [inviteState, inviteFormAction, isInvitePending] = useActionState(
    inviteToOccurrenceAction,
    INITIAL_OPERATION_STATE,
  );

  const status = participation?.status ?? null;

  return (
    <div className={styles.panel}>
      <div className={styles.statusRow}>
        {status === 'attending' ? <Badge variant="success">参加する</Badge> : null}
        {status === 'considering' ? <Badge variant="info">気になる</Badge> : null}
        {status === null ? <Badge variant="neutral">未設定</Badge> : null}
      </div>

      <form action={formAction} className={styles.form} aria-busy={isPending}>
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="occurrenceId" value={occurrenceId} />
        {participation !== null ? (
          <input type="hidden" name="participationId" value={participation.id} />
        ) : null}

        {state.feedback ? (
          <StatePanel
            key={state.attempt}
            variant={state.feedback.variant}
            title={state.feedback.title}
            description={state.feedback.description}
          />
        ) : null}
        <WriteNotice notice={state.notice} attempt={state.attempt} />

        <div className={styles.actions}>
          {status !== 'considering' ? (
            <Button
              type="submit"
              name="intent"
              value="considering"
              variant="secondary"
              disabled={isPending}
            >
              気になる
            </Button>
          ) : null}
          {status !== 'attending' ? (
            <Button type="submit" name="intent" value="attending" disabled={isPending}>
              参加する
            </Button>
          ) : null}
          {status !== null ? (
            <Button
              type="submit"
              name="intent"
              value="withdraw"
              variant="secondary"
              disabled={isPending}
            >
              参加予定を解除
            </Button>
          ) : null}
        </div>
      </form>

      {status === 'attending' ? (
        <form action={inviteFormAction} className={styles.inviteForm} aria-busy={isInvitePending}>
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="occurrenceId" value={occurrenceId} />

          {inviteState.feedback ? (
            <StatePanel
              key={inviteState.attempt}
              variant={inviteState.feedback.variant}
              title={inviteState.feedback.title}
              description={inviteState.feedback.description}
            />
          ) : null}
          <WriteNotice notice={inviteState.notice} attempt={inviteState.attempt} />

          <TextInput
            key={inviteState.attempt}
            label="招待するユーザーの登録メールアドレス"
            name="email"
            type="email"
            required
            disabled={isInvitePending}
            defaultValue={inviteState.values.email ?? ''}
            error={inviteState.fieldError ?? undefined}
            helperText="Stage Trackerに登録済みのメールアドレスを入力してください。"
          />
          <div className={styles.actions}>
            <Button type="submit" disabled={isInvitePending}>
              {isInvitePending ? '送信中…' : '招待する'}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
