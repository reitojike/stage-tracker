'use client';

import { useState } from 'react';
import { Sheet } from '@/ui/Sheet';
import { StatePanel } from '@/ui/StatePanel';
import type { OperationFeedback } from '@/domain/participationFeedback.ts';
import type { Participation, ParticipationStatus } from '@/domain/participation.ts';
import { occurrenceTimeRangeLabel, tokyoDateLabel } from '@/domain/catalogFormatting.ts';
import { participationStatusLabel } from '@/domain/myCalendarFormatting.ts';
import { setParticipationChoiceAction } from '../_actions/participationWrite.ts';
import { WriteNotice } from '@/ui/WriteNotice';
import styles from './ParticipationSheet.module.css';

export interface ParticipationSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  occurrenceId: string;
  occurrence: { startsAt: string; endsAt: string | null };
  /** The caller's own participation for this occurrence, or null - absence
   * of a row is "not participating" (Issue #36/#230: there is no
   * `not_attending` status). */
  participation: Participation | null;
  /** Issue #125/#123: on an effectively canceled occurrence this sheet must
   * not offer a choice that would create a new active commitment - only
   * withdrawal (when there is something to withdraw) remains offered. The
   * database is what actually enforces this (supabase/migrations/
   * 20260826000200_create_event_occurrence_cancellation.sql); this is a UX
   * courtesy, not the enforcement boundary. */
  isEffectivelyCanceled: boolean;
}

type Choice = 'attending' | 'considering' | 'withdraw';

// Reuses myCalendarFormatting.ts's participationStatusLabel for the two real
// statuses instead of re-deriving the same two strings a third time (also
// used by OccurrenceParticipationRow.tsx's own statusText); "withdraw" has
// no participation-status counterpart to reuse.
const CHOICE_LABEL: Record<Choice, string> = {
  attending: participationStatusLabel('attending'),
  considering: participationStatusLabel('considering'),
  withdraw: '参加をやめる',
};

function currentChoice(status: ParticipationStatus | null): Choice | null {
  if (status === 'attending') {
    return 'attending';
  }
  if (status === 'considering') {
    return 'considering';
  }
  return null;
}

/**
 * Event detail "参加の状態" bottom sheet (Issue #230 addendum), reusing the
 * shared src/ui/Sheet.tsx primitive. Choosing a row saves immediately and
 * closes the sheet - there is no separate confirm/save button, and no
 * segmented-control affordance: the three choices are vertical rows, the
 * current one marked with a left indigo rule + "選択中" label.
 */
export function ParticipationSheet({
  open,
  onOpenChange,
  eventId,
  occurrenceId,
  occurrence,
  participation,
  isEffectivelyCanceled,
}: ParticipationSheetProps) {
  const [pendingChoice, setPendingChoice] = useState<Choice | null>(null);
  const [feedback, setFeedback] = useState<OperationFeedback | null>(null);
  // WriteNotice's own live region (not this sheet's visible content) is what
  // announces a successful choice to assistive tech - the sheet closes
  // immediately per the addendum's "no separate confirm/save button", so
  // there is deliberately no visible confirmation text to read instead.
  const [notice, setNotice] = useState<{ text: string; attempt: number } | null>(null);

  const selected = currentChoice(participation?.status ?? null);

  // "参加をやめる" only makes sense when there is a participation to
  // withdraw - offering it against a rowless caller would let them "choose"
  // a no-op (setParticipationChoiceAction's withdraw branch short-circuits
  // to ok:true with no write when participationId is null), which reads as
  // a silent failure: the sheet closes as if something happened.
  const choices: Choice[] = isEffectivelyCanceled
    ? participation !== null
      ? ['withdraw']
      : []
    : participation !== null
      ? ['attending', 'considering', 'withdraw']
      : ['attending', 'considering'];

  function handleChoose(choice: Choice) {
    if (choice === selected) {
      onOpenChange(false);
      return;
    }
    setFeedback(null);
    setPendingChoice(choice);
    void (async () => {
      const result = await setParticipationChoiceAction(
        eventId,
        occurrenceId,
        choice,
        participation?.id ?? null,
      );
      setPendingChoice(null);
      if (!result.ok) {
        setFeedback(result.feedback);
        return;
      }
      setNotice((previous) => ({
        text: `「${CHOICE_LABEL[choice]}」に設定しました。`,
        attempt: (previous?.attempt ?? 0) + 1,
      }));
      onOpenChange(false);
    })();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="参加の状態">
      <WriteNotice notice={notice?.text ?? null} attempt={notice?.attempt ?? 0} />
      <p className={styles.occurrenceTime}>
        {tokyoDateLabel(occurrence.startsAt)}{' '}
        {occurrenceTimeRangeLabel(occurrence.startsAt, occurrence.endsAt)}
      </p>

      {feedback !== null ? (
        <StatePanel
          variant={feedback.variant}
          title={feedback.title}
          description={feedback.description}
        />
      ) : null}
      {choices.length === 0 ? (
        <p className={styles.empty}>この公演は中止されているため、選択できる項目がありません。</p>
      ) : (
        <ul className={styles.choices} aria-busy={pendingChoice !== null}>
          {choices.map((choice) => {
            const isSelected = choice === selected;
            return (
              <li key={choice}>
                <button
                  type="button"
                  className={[styles.choice, isSelected ? styles.choiceSelected : '']
                    .filter(Boolean)
                    .join(' ')}
                  disabled={pendingChoice !== null}
                  onClick={() => {
                    handleChoose(choice);
                  }}
                >
                  <span className={styles.choiceLabel}>{CHOICE_LABEL[choice]}</span>
                  {isSelected ? <span className={styles.selectedTag}>選択中</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
