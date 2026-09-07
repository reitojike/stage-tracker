'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import type { OperationFeedback } from '@/domain/participationFeedback.ts';
import type { Invitation } from '@/domain/invitation.ts';
import { occurrenceTimeRangeLabel, tokyoDateLabel } from '@/domain/catalogFormatting.ts';
import {
  acceptInvitationAction,
  finalizeDeclineInvitationAction,
} from '../_actions/participationWrite.ts';
import styles from './InvitationCard.module.css';

/** PO/Claude Design addendum (Issue #230 comment, 2026-08-30): "8 seconds, or
 * when leaving the screen, the decline is final." */
const DECLINE_UNDO_WINDOW_MS = 8000;

export interface InvitationCardProps {
  invitation: Invitation;
  /** null when the occurrence/event context read failed - the page has
   * already surfaced that as an error, so this renders the invitation
   * without fabricating a date/title rather than guessing at one. */
  occurrence: { startsAt: string; endsAt: string | null } | null;
  /** null when the occurrence/event context read failed, or when the
   * occurrence's event id could not be resolved - accept still works either
   * way (it only needs occurrenceId), this is only used to also revalidate
   * the Event detail page's own cached participation state. */
  eventId: string | null;
  eventTitle: string | null;
  /** Issue #125/#123: an invitation is retained (never deleted) when its
   * Event/Occurrence is canceled - so this screen must be able to show
   * "中止" for one, the same as catalog/detail/calendar surfaces do. Passed
   * as an already-computed boolean (the page has the full Event/Occurrence
   * rows to derive it from via domain/eventCancellation.ts's
   * isEffectivelyCanceled); defaults to false only for the context-read-
   * failure case, where occurrence/eventTitle are also null. */
  isEffectivelyCanceled: boolean;
  /** Fires once this invitation is resolved (accepted or declined) so the
   * parent list (InvitationList.tsx) can drop it from view immediately,
   * without a full page reload - the pending-only list has no "resolved"
   * row to render (Issue #225/#230 addendum: "resolved accept/decline rows
   * are not shown as history"). `noticeText` is a short confirmation for
   * InvitationList's shared WriteNotice live region: this card is removed
   * from the DOM the instant this fires, so a live region local to the card
   * itself would never get a chance to be announced by assistive tech. */
  onResolved: (noticeText: string) => void;
  /** Issue #240: fires whenever this card enters/exits the 8-second
   * decline-undo window, so InvitationList can exclude it from the
   * "未回答 {n}件" pending count while it's showing the undo row (a
   * declining card is not yet finalized as declined, but it also is not an
   * unanswered invitation the count should include). Optional so this
   * component has no hard dependency on a parent that tracks it. */
  onDecliningChange?: (isDeclining: boolean) => void;
}

type CardPhase = 'pending' | 'busy' | 'declining';

/**
 * One pending invitation, with direct in-place accept/decline (Issue
 * #225/#230 addendum, superseding Issue #36's original card: a decline no
 * longer produces a durable "辞退済み" history row - resolved invitations
 * simply stop being fetched, see supabase/migrations/20260830000000_
 * simplify_invitation_pending_only.sql).
 *
 * Accepting is exactly "set my participation for this occurrence to
 * attending" (acceptInvitationAction) - indistinguishable from doing the
 * same thing through the ordinary Event detail Participation sheet.
 *
 * Declining has an 8-second, purely client-local undo window before the
 * server call is actually made (finalizeDeclineInvitationAction): the "参加
 * しない" click flips this card into an optimistic "declining" phase without
 * writing anything yet, and a timer or this component's own unmount (screen
 * leave, e.g. client-side navigation away from /catalog/invitations) is what
 * finalizes it. This keeps the pending-only model intact - there is no new
 * "declining"/"undo-pending" persisted state anywhere, only a delayed call
 * to the same finalize action a plain decline would always have made.
 *
 * Deliberately does not show who sent this invitation: the typed boundary
 * (listMyReceivedInvitations) returns the inviter's user id, but this
 * feature has no lookup from a user id to anything display-worthy (Issue
 * #36 PO checkpoint: no user directory), so showing raw ids would leak
 * exactly the kind of internal identifier that checkpoint ruled out
 * exposing in the UI.
 */
export function InvitationCard({
  invitation,
  occurrence,
  eventId,
  eventTitle,
  isEffectivelyCanceled,
  onResolved,
  onDecliningChange,
}: InvitationCardProps) {
  const [phase, setPhase] = useState<CardPhase>('pending');
  const [feedback, setFeedback] = useState<OperationFeedback | null>(null);
  const router = useRouter();

  // Read at unmount time via a ref (not the `phase` state closure directly):
  // an effect keyed on `phase` would re-run its cleanup on every transition
  // out of 'declining' too (e.g. undo), not only on a genuine unmount, and
  // would then wrongly finalize a decline the invitee just undid. A ref kept
  // current on every render lets the mount-only cleanup below check the
  // *latest* phase specifically at actual unmount time.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const finalizedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearUndoTimer() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  // Returns the result so the timer-driven caller (handleDecline) can keep
  // the card hidden only on success, and the unmount-driven caller (the
  // effect below) can stay fire-and-forget - there is no UI left to update
  // once this component has actually unmounted.
  function finalizeDeclineOnce() {
    if (finalizedRef.current) {
      return Promise.resolve(null);
    }
    finalizedRef.current = true;
    clearUndoTimer();
    return finalizeDeclineInvitationAction(invitation.id);
  }

  // Mount/unmount only, deliberately not depending on `phase` or the
  // functions below - see the phaseRef comment above for why.
  useEffect(() => {
    return () => {
      if (phaseRef.current === 'declining') {
        // Fire-and-forget: the component has actually unmounted (screen
        // left), there is no UI left here to update on failure. A failed
        // finalize simply leaves the invitation pending server-side, where
        // the next fetch of /catalog/invitations will show it again.
        void finalizeDeclineOnce();
      }
    };
    // eslint config forbids suppression comments (foundation/no-suppression)
    // instead of an exhaustive-deps disable directive, this effect closes
    // over stable refs only (phaseRef, finalizedRef, timerRef) and never
    // reads a value that would need to be in the dependency array.
  }, []);

  function handleAccept() {
    setFeedback(null);
    setPhase('busy');
    void (async () => {
      const result = await acceptInvitationAction(invitation.occurrenceId, eventId);
      if (!result.ok) {
        setFeedback(result.feedback);
        setPhase('pending');
        return;
      }
      onResolved(`${eventTitle ?? 'この招待'}への参加を承諾しました。`);
      // Accepting can resolve more than just this card: the same occurrence
      // may have pending invitations from other inviters too, and the DB
      // trigger (occurrence_participations_resolve_invitations_on_attending)
      // resolves all of them server-side as one atomic side effect of this
      // same write (see acceptInvitationAction's own header comment).
      // onResolved() above only removes *this* card from the client-local
      // resolved set; refresh so any sibling card - now stale - is dropped
      // by the next server render instead of continuing to render as
      // actionable until the invitee happens to reload the page.
      router.refresh();
    })();
  }

  function handleDecline() {
    setFeedback(null);
    setPhase('declining');
    onDecliningChange?.(true);
    timerRef.current = setTimeout(() => {
      void (async () => {
        const result = await finalizeDeclineOnce();
        // null only when this timer fired after finalizeDeclineOnce had
        // already run once (it hasn't - clearUndoTimer inside
        // finalizeDeclineOnce cancels this very timer on its first call -
        // but guarding keeps this branch correct even if that changes).
        if (result === null) {
          return;
        }
        if (!result.ok) {
          // Allow a retry: this attempt never reached the server as a
          // successful decline, so the invitation is still pending there.
          finalizedRef.current = false;
          setFeedback(result.feedback);
          setPhase('pending');
          onDecliningChange?.(false);
          return;
        }
        onDecliningChange?.(false);
        onResolved(`${eventTitle ?? 'この招待'}を辞退しました。`);
      })();
    }, DECLINE_UNDO_WINDOW_MS);
  }

  function handleUndoDecline() {
    clearUndoTimer();
    setPhase('pending');
    onDecliningChange?.(false);
  }

  function handleCloseCanceled() {
    // Issue #230 addendum: for an effectively canceled occurrence, "閉じる"
    // has the same domain effect as decline - resolve the pending
    // invitation, never touch Participation - but with no undo window (the
    // addendum scopes the undo requirement to the normal 参加しない action
    // only).
    setFeedback(null);
    setPhase('busy');
    void (async () => {
      const result = await finalizeDeclineInvitationAction(invitation.id);
      if (!result.ok) {
        setFeedback(result.feedback);
        setPhase('pending');
        return;
      }
      onResolved(`${eventTitle ?? 'この招待'}を閉じました。`);
    })();
  }

  if (phase === 'declining') {
    return (
      <div className={styles.card}>
        <div className={styles.undoRow}>
          <span className={styles.undoText}>参加しないにしました</span>
          <button type="button" className={styles.undoButton} onClick={handleUndoDecline}>
            取り消す
          </button>
        </div>
      </div>
    );
  }

  const isBusy = phase === 'busy';

  return (
    <div className={styles.card} aria-busy={isBusy}>
      <p className={styles.title}>
        {isEffectivelyCanceled ? (
          <Badge variant="terminal" className={styles.canceledBadge}>
            中止
          </Badge>
        ) : null}
        {eventTitle ?? '（イベント情報を読み込めませんでした）'}
      </p>
      {occurrence !== null ? (
        <p className={styles.occurrenceTime}>
          {tokyoDateLabel(occurrence.startsAt)}{' '}
          {occurrenceTimeRangeLabel(occurrence.startsAt, occurrence.endsAt)}
        </p>
      ) : null}

      {feedback !== null ? (
        <StatePanel
          variant={feedback.variant}
          title={feedback.title}
          description={feedback.description}
        />
      ) : null}

      <div className={styles.actions}>
        {isEffectivelyCanceled ? (
          <Button type="button" variant="quiet" disabled={isBusy} onClick={handleCloseCanceled}>
            閉じる
          </Button>
        ) : (
          <>
            <Button type="button" variant="quiet" disabled={isBusy} onClick={handleDecline}>
              参加しない
            </Button>
            <Button type="button" variant="secondary" disabled={isBusy} onClick={handleAccept}>
              <span className={styles.stablePendingLabel}>
                <span aria-hidden="true" className={styles.stablePendingSizing}>
                  参加する
                </span>
                <span>{isBusy ? '参加中…' : '参加する'}</span>
              </span>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
