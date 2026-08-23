'use client';

import { useActionState } from 'react';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { INITIAL_OPERATION_STATE } from '@/domain/participationFeedback.ts';
import type { Invitation } from '@/domain/invitation.ts';
import { occurrenceTimeRangeLabel, tokyoDateLabel } from '@/domain/catalogFormatting.ts';
import { declineInvitationAction } from '../_actions/participationWrite.ts';
import { WriteNotice } from './WriteNotice.tsx';
import styles from './InvitationCard.module.css';

export interface InvitationCardProps {
  invitation: Invitation;
  /** null when the occurrence/event context read failed - the page has
   * already surfaced that as an error, so this renders the invitation
   * without fabricating a date/title rather than guessing at one. */
  occurrence: { startsAt: string; endsAt: string | null } | null;
  eventTitle: string | null;
}

/**
 * One received invitation, with its decline action (Issue #36). Declining
 * is idempotent (see src/infrastructure/supabase/invitation.ts's
 * declineInvitation), so this still renders a working decline form for an
 * already-declined invitation rather than only a static badge - resubmitting
 * simply returns the same declinedAt.
 *
 * Deliberately does not show who sent this invitation: the typed boundary
 * (listMyReceivedInvitations) returns the inviter's user id, but this
 * feature has no lookup from a user id to anything display-worthy (Issue
 * #36 PO checkpoint: no user directory), so showing raw ids would leak
 * exactly the kind of internal identifier that checkpoint ruled out
 * exposing in the UI.
 */
export function InvitationCard({ invitation, occurrence, eventTitle }: InvitationCardProps) {
  const [state, formAction, isPending] = useActionState(
    declineInvitationAction,
    INITIAL_OPERATION_STATE,
  );

  const isDeclined = invitation.declinedAt !== null;

  return (
    <div className={styles.card}>
      <p className={styles.title}>{eventTitle ?? '（イベント情報を読み込めませんでした）'}</p>
      {occurrence !== null ? (
        <p className={styles.occurrenceTime}>
          {tokyoDateLabel(occurrence.startsAt)}{' '}
          {occurrenceTimeRangeLabel(occurrence.startsAt, occurrence.endsAt)}
        </p>
      ) : null}

      {isDeclined ? <Badge variant="neutral">辞退済み</Badge> : null}

      <form action={formAction} aria-busy={isPending}>
        <input type="hidden" name="invitationId" value={invitation.id} />

        {state.feedback ? (
          <StatePanel
            key={state.attempt}
            variant={state.feedback.variant}
            title={state.feedback.title}
            description={state.feedback.description}
          />
        ) : null}
        <WriteNotice notice={state.notice} attempt={state.attempt} />

        {!isDeclined ? (
          <Button type="submit" variant="secondary" disabled={isPending}>
            {isPending ? '処理中…' : '辞退する'}
          </Button>
        ) : null}
      </form>
    </div>
  );
}
