import Link from 'next/link';
import { StatePanel } from '@/ui/StatePanel';
import { Badge } from '@/ui/Badge';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient.ts';
import { requireAuthenticatedUserId } from '@/infrastructure/supabase/planningAuth.ts';
import {
  getVisiblePersonalScheduleEntry,
  listScheduleShares,
} from '@/infrastructure/supabase/personalSchedule.ts';
import { resolvePersonalScheduleReadState } from '@/domain/personalScheduleReadState.ts';
import { scheduleTemporalLabel, scheduleTypeLabel } from '@/domain/personalScheduleFormatting.ts';
import { findOwnScheduleShare, type PersonalScheduleEntry } from '@/domain/personalSchedule.ts';
import { LeaveShareForm } from '../_components/LeaveShareForm.tsx';

interface ScheduleEntryPageProps {
  params: Promise<{ entryId: string }>;
}

const isMissingEntry = (data: PersonalScheduleEntry | null) => data === null;

/**
 * Read-only single-entry detail surface (Issue #37). A non-existent or
 * not-visible id is a distinct "empty" result (RLS makes the two
 * indistinguishable - see getVisiblePersonalScheduleEntry), never an
 * "error"; a genuine read failure is the reverse (see
 * resolvePersonalScheduleReadState).
 *
 * Owner-side recipient management (add/remove, or even a read-only
 * recipient list) is deliberately not rendered here: it is blocked pending
 * #55's cross-cutting identity-targeting prerequisite (see
 * _actions/scheduleWrite.ts). Only the shared recipient's own self-remove
 * affordance is offered, since that needs no identity resolution.
 *
 * Identity is resolved via requireAuthenticatedUserId (which distinguishes
 * a genuine auth failure from "not signed in"), not
 * session.ts's getAuthenticatedUser (which collapses both into `null`).
 * Collapsing them here would fail *open*: a transient auth-check failure
 * for the actual owner would read as "not the owner", and this page would
 * then treat the owner as a recipient and hand back some *other*
 * recipient's share id from ownShareId - see findOwnScheduleShare's own
 * comment for why that is exploitable (the owner's DELETE grant on any
 * recipient's share row would let the "leave" button actually remove
 * someone else's access). A failed identity check is therefore its own
 * explicit error state below, never silently treated as "this caller is a
 * recipient".
 */
export default async function ScheduleEntryPage({ params }: ScheduleEntryPageProps) {
  const { entryId } = await params;

  const client = await createSupabaseServerClient();
  const [result, callerResult] = await Promise.all([
    getVisiblePersonalScheduleEntry(client, entryId),
    requireAuthenticatedUserId(client),
  ]);
  const state = resolvePersonalScheduleReadState(result, isMissingEntry);
  const entry = result.ok ? result.data : null;

  let isOwner = false;
  let ownShareId: string | null = null;
  if (entry !== null && callerResult.ok) {
    isOwner = entry.ownerId === callerResult.data;
    if (!isOwner) {
      const shares = await listScheduleShares(client, entry.id);
      // Matched by the caller's confirmed id, not "the first row" - see
      // findOwnScheduleShare's comment. Necessary because a *owner's* read
      // of this table (not this caller, but relevant if isOwner were ever
      // miscomputed) returns every recipient's row, not just one.
      ownShareId = shares.ok
        ? (findOwnScheduleShare(shares.data, callerResult.data)?.id ?? null)
        : null;
    }
  }

  return (
    <main>
      <Link href="/schedule">← Personal Scheduleに戻る</Link>

      {state === 'error' ? (
        <StatePanel
          variant="error"
          title="予定を読み込めませんでした"
          description="通信状況を確認し、もう一度お試しください。"
        />
      ) : null}
      {state === 'empty' ? (
        <StatePanel variant="empty" title="指定された予定が見つかりません" />
      ) : null}

      {entry !== null ? (
        <>
          {callerResult.ok ? (
            <Badge variant={isOwner ? 'neutral' : 'info'}>
              {isOwner ? '自分の予定' : '共有されている予定'}
            </Badge>
          ) : null}
          <h1>{scheduleTypeLabel(entry.scheduleType)}</h1>
          <p>{scheduleTemporalLabel(entry.temporal)}</p>
          {entry.memo !== null ? <p>{entry.memo}</p> : null}

          {callerResult.ok ? (
            <>
              {isOwner ? <Link href={`/schedule/${entry.id}/edit`}>編集する</Link> : null}
              {!isOwner && ownShareId !== null ? <LeaveShareForm shareId={ownShareId} /> : null}
            </>
          ) : (
            <StatePanel
              variant="error"
              title="権限を確認できませんでした"
              description="通信状況を確認し、もう一度お試しください。"
            />
          )}
        </>
      ) : null}
    </main>
  );
}
