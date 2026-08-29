'use client';

import { useState } from 'react';
import { StatePanel } from '@/ui/StatePanel';
import type { Invitation } from '@/domain/invitation.ts';
import { InvitationCard } from './InvitationCard.tsx';
import { WriteNotice } from './WriteNotice.tsx';

export interface InvitationListItem {
  invitation: Invitation;
  occurrence: { startsAt: string; endsAt: string | null } | null;
  eventId: string | null;
  eventTitle: string | null;
  isEffectivelyCanceled: boolean;
}

export interface InvitationListProps {
  items: readonly InvitationListItem[];
}

/**
 * Client-local pending-invitation list (Issue #225/#230 addendum): tracks
 * which invitations this viewer has resolved (accepted/declined) *in this
 * render*, so the list can converge on the "招待はありません" empty state the
 * instant the last pending row resolves, without a full server round trip -
 * each InvitationCard reports its own resolution via `onResolved`, this
 * component never re-derives resolution itself.
 *
 * `items` is exactly what the server fetched for this page load; this
 * component performs no additional data fetching or revalidation of its own.
 *
 * Also owns the one shared WriteNotice live region for the whole list: each
 * resolved InvitationCard is removed from the DOM the instant it resolves
 * (there is no "resolved" row to keep it mounted for), so a live region
 * local to the card itself would be unmounted before assistive tech had a
 * chance to announce it. Lifting the region here - rendered above the
 * empty/populated branch below, so it survives the transition into the
 * empty state too - is what keeps the announcement audible.
 */
export function InvitationList({ items }: InvitationListProps) {
  const [resolvedIds, setResolvedIds] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<{ text: string; attempt: number } | null>(null);

  function resolve(invitationId: string, noticeText: string) {
    setResolvedIds((previous) => {
      const next = new Set(previous);
      next.add(invitationId);
      return next;
    });
    setNotice((previous) => ({ text: noticeText, attempt: (previous?.attempt ?? 0) + 1 }));
  }

  const visible = items.filter((item) => !resolvedIds.has(item.invitation.id));

  return (
    <>
      <WriteNotice notice={notice?.text ?? null} attempt={notice?.attempt ?? 0} />
      {visible.length === 0 ? (
        <StatePanel variant="empty" title="招待はありません" />
      ) : (
        <ul>
          {visible.map((item) => (
            <li key={item.invitation.id}>
              <InvitationCard
                invitation={item.invitation}
                occurrence={item.occurrence}
                eventId={item.eventId}
                eventTitle={item.eventTitle}
                isEffectivelyCanceled={item.isEffectivelyCanceled}
                onResolved={(noticeText) => {
                  resolve(item.invitation.id, noticeText);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
