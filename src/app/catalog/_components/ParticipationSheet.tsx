'use client';

import { useState } from 'react';
import { Sheet } from '@/ui/Sheet';
import { StatePanel } from '@/ui/StatePanel';
import type { OperationFeedback } from '@/domain/participationFeedback.ts';
import type { Participation, ParticipationStatus } from '@/domain/participation.ts';
import { occurrenceTimeRangeLabel, tokyoDateLabel } from '@/domain/catalogFormatting.ts';
import { setParticipationChoiceAction } from '../_actions/participationWrite.ts';
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

const CHOICE_LABEL: Record<Choice, string> = {
  attending: '参加する',
  considering: '気になる',
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

  const selected = currentChoice(participation?.status ?? null);

  const choices: Choice[] = isEffectivelyCanceled
    ? participation !== null
      ? ['withdraw']
      : []
    : ['attending', 'considering', 'withdraw'];

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
      onOpenChange(false);
    })();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="参加の状態">
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
        <ul className={styles.choices}>
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
