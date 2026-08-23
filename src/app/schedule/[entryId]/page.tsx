import Link from 'next/link';
import { StatePanel } from '@/ui/StatePanel';
import { Badge } from '@/ui/Badge';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient.ts';
import { getAuthenticatedUser } from '@/infrastructure/supabase/session.ts';
import {
  getVisiblePersonalScheduleEntry,
  listScheduleShares,
} from '@/infrastructure/supabase/personalSchedule.ts';
import { resolvePersonalScheduleReadState } from '@/domain/personalScheduleReadState.ts';
import { scheduleTemporalLabel, scheduleTypeLabel } from '@/domain/personalScheduleFormatting.ts';
import type { PersonalScheduleEntry } from '@/domain/personalSchedule.ts';
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
 * a cross-cutting identity-targeting prerequisite (see
 * _actions/scheduleWrite.ts). Only the shared recipient's own self-remove
 * affordance is offered, since that needs no identity resolution.
 */
export default async function ScheduleEntryPage({ params }: ScheduleEntryPageProps) {
  const { entryId } = await params;

  const client = await createSupabaseServerClient();
  const [result, user] = await Promise.all([
    getVisiblePersonalScheduleEntry(client, entryId),
    getAuthenticatedUser(),
  ]);
  const state = resolvePersonalScheduleReadState(result, isMissingEntry);
  const entry = result.ok ? result.data : null;
  const isOwner = entry !== null && user !== null && entry.ownerId === user.id;

  let ownShareId: string | null = null;
  if (entry !== null && !isOwner) {
    const shares = await listScheduleShares(client, entry.id);
    // A recipient's read of this table is scoped to exactly their own row
    // (personal_schedule_shares_select_owner_or_recipient), so this is
    // never someone else's share id.
    ownShareId = shares.ok ? (shares.data[0]?.id ?? null) : null;
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
          <Badge variant={isOwner ? 'neutral' : 'info'}>
            {isOwner ? '自分の予定' : '共有されている予定'}
          </Badge>
          <h1>{scheduleTypeLabel(entry.scheduleType)}</h1>
          <p>{scheduleTemporalLabel(entry.temporal)}</p>
          {entry.memo !== null ? <p>{entry.memo}</p> : null}

          {isOwner ? <Link href={`/schedule/${entry.id}/edit`}>編集する</Link> : null}

          {!isOwner && ownShareId !== null ? <LeaveShareForm shareId={ownShareId} /> : null}
        </>
      ) : null}
    </main>
  );
}
