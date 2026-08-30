'use client';

import { useState } from 'react';
import { PageHeading } from '@/ui/PageHeading';
import { StatePanel } from '@/ui/StatePanel';
import type { Invitation } from '@/domain/invitation.ts';
import { InvitationCard } from './InvitationCard.tsx';
import { WriteNotice } from './WriteNotice.tsx';
import styles from './InvitationList.module.css';

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
 *
 * Issue #240: also owns the page heading + "未回答 {n}件" pending count
 * (moved in from catalog/invitations/page.tsx so the count can react to
 * client-local declining/undo state - a server component has no visibility
 * into a card's in-flight 8-second undo window). `decliningIds` tracks
 * which currently-visible cards are showing that undo row; those are
 * excluded from the count ("取り消し待ちの行は含めない") without being
 * treated as resolved (they still render, and still count as `visible`).
 */
export function InvitationList({ items }: InvitationListProps) {
  const [resolvedIds, setResolvedIds] = useState<ReadonlySet<string>>(new Set());
  const [decliningIds, setDecliningIds] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<{ text: string; attempt: number } | null>(null);

  function resolve(invitationId: string, noticeText: string) {
    setResolvedIds((previous) => {
      const next = new Set(previous);
      next.add(invitationId);
      return next;
    });
    setDecliningIds((previous) => {
      if (!previous.has(invitationId)) {
        return previous;
      }
      const next = new Set(previous);
      next.delete(invitationId);
      return next;
    });
    setNotice((previous) => ({ text: noticeText, attempt: (previous?.attempt ?? 0) + 1 }));
  }

  function setDeclining(invitationId: string, isDeclining: boolean) {
    setDecliningIds((previous) => {
      const alreadyPresent = previous.has(invitationId);
      if (isDeclining === alreadyPresent) {
        return previous;
      }
      const next = new Set(previous);
      if (isDeclining) {
        next.add(invitationId);
      } else {
        next.delete(invitationId);
      }
      return next;
    });
  }

  const visible = items.filter((item) => !resolvedIds.has(item.invitation.id));
  const pendingCount = visible.filter((item) => !decliningIds.has(item.invitation.id)).length;

  return (
    <>
      <div className={styles.headingRow}>
        <PageHeading>招待一覧</PageHeading>
        <span className={styles.pendingCount}>未回答 {pendingCount}件</span>
      </div>

      <WriteNotice notice={notice?.text ?? null} attempt={notice?.attempt ?? 0} />
      {visible.length === 0 ? (
        <StatePanel variant="empty" title="招待はありません" />
      ) : (
        <ul className={styles.list}>
          {visible.map((item) => (
            <li key={item.invitation.id} className={styles.item}>
              <InvitationCard
                invitation={item.invitation}
                occurrence={item.occurrence}
                eventId={item.eventId}
                eventTitle={item.eventTitle}
                isEffectivelyCanceled={item.isEffectivelyCanceled}
                onResolved={(noticeText) => {
                  resolve(item.invitation.id, noticeText);
                }}
                onDecliningChange={(isDeclining) => {
                  setDeclining(item.invitation.id, isDeclining);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
