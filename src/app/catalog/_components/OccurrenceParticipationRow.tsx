'use client';

import { useState } from 'react';
import { Button } from '@/ui/Button';
import type { Participation } from '@/domain/participation.ts';
import { ParticipationSheet } from './ParticipationSheet.tsx';
import { InviteSheet } from './InviteSheet.tsx';
import styles from './OccurrenceParticipationRow.module.css';

export interface OccurrenceParticipationRowProps {
  eventId: string;
  occurrenceId: string;
  occurrence: { startsAt: string; endsAt: string | null };
  /** The caller's own participation for this occurrence, or null - "not
   * participating" (Issue #36/#230: absence of a row, no `not_attending`
   * status). */
  participation: Participation | null;
  isEffectivelyCanceled: boolean;
}

function statusText(status: Participation['status'] | null): string {
  if (status === 'attending') {
    return '参加する';
  }
  if (status === 'considering') {
    return '気になる';
  }
  return '未定';
}

/**
 * Compact per-occurrence participation status + actions (Issue #230
 * addendum), replacing the former ParticipationPanel white card and its
 * inline invite-by-email form. A normal row carries at most two quiet
 * actions (変更, and 招待 only while attending on a non-canceled occurrence)
 * - both open the same shared src/ui/Sheet.tsx-based bottom sheet vocabulary
 * (ParticipationSheet / InviteSheet) rather than expanding inline.
 */
export function OccurrenceParticipationRow({
  eventId,
  occurrenceId,
  occurrence,
  participation,
  isEffectivelyCanceled,
}: OccurrenceParticipationRowProps) {
  const [sheet, setSheet] = useState<'none' | 'participation' | 'invite'>('none');

  const canInvite = participation?.status === 'attending' && !isEffectivelyCanceled;

  return (
    <div className={styles.row}>
      <span className={styles.statusText}>{statusText(participation?.status ?? null)}</span>
      <div className={styles.actions}>
        <Button
          type="button"
          variant="quiet"
          onClick={() => {
            setSheet('participation');
          }}
        >
          変更
        </Button>
        {canInvite ? (
          <Button
            type="button"
            variant="quiet"
            onClick={() => {
              setSheet('invite');
            }}
          >
            招待
          </Button>
        ) : null}
      </div>

      <ParticipationSheet
        open={sheet === 'participation'}
        onOpenChange={(open) => {
          setSheet(open ? 'participation' : 'none');
        }}
        eventId={eventId}
        occurrenceId={occurrenceId}
        occurrence={occurrence}
        participation={participation}
        isEffectivelyCanceled={isEffectivelyCanceled}
      />
      <InviteSheet
        open={sheet === 'invite'}
        onOpenChange={(open) => {
          setSheet(open ? 'invite' : 'none');
        }}
        eventId={eventId}
        occurrenceId={occurrenceId}
        occurrence={occurrence}
      />
    </div>
  );
}
