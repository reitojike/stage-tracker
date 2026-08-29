'use client';

import { useState } from 'react';
import { StatePanel } from '@/ui/StatePanel';
import type { Invitation } from '@/domain/invitation.ts';
import { InvitationCard } from './InvitationCard.tsx';

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
 */
export function InvitationList({ items }: InvitationListProps) {
  const [resolvedIds, setResolvedIds] = useState<ReadonlySet<string>>(new Set());

  const visible = items.filter((item) => !resolvedIds.has(item.invitation.id));

  if (visible.length === 0) {
    return <StatePanel variant="empty" title="招待はありません" />;
  }

  return (
    <ul>
      {visible.map((item) => (
        <li key={item.invitation.id}>
          <InvitationCard
            invitation={item.invitation}
            occurrence={item.occurrence}
            eventId={item.eventId}
            eventTitle={item.eventTitle}
            isEffectivelyCanceled={item.isEffectivelyCanceled}
            onResolved={() => {
              setResolvedIds((previous) => {
                const next = new Set(previous);
                next.add(item.invitation.id);
                return next;
              });
            }}
          />
        </li>
      ))}
    </ul>
  );
}
