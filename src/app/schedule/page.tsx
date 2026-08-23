import Link from 'next/link';
import { Badge } from '@/ui/Badge';
import { StatePanel } from '@/ui/StatePanel';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient.ts';
import { getAuthenticatedUser } from '@/infrastructure/supabase/session.ts';
import { listVisiblePersonalSchedule } from '@/infrastructure/supabase/personalSchedule.ts';
import { resolvePersonalScheduleReadState } from '@/domain/personalScheduleReadState.ts';
import { scheduleTemporalLabel, scheduleTypeLabel } from '@/domain/personalScheduleFormatting.ts';
import type { PersonalScheduleEntry } from '@/domain/personalSchedule.ts';
import styles from './_components/ScheduleList.module.css';

const isEmptySchedule = (data: PersonalScheduleEntry[]) => data.length === 0;

/**
 * Personal schedule listing (Issue #37): every entry visible to the caller
 * - their own, plus every entry explicitly shared with them
 * (listVisiblePersonalSchedule already merges both via RLS). Reachability
 * is enforced by the existing default-deny boundary (src/proxy.ts).
 */
export default async function SchedulePage() {
  const client = await createSupabaseServerClient();
  const [result, user] = await Promise.all([
    listVisiblePersonalSchedule(client),
    getAuthenticatedUser(),
  ]);
  const state = resolvePersonalScheduleReadState(result, isEmptySchedule);

  return (
    <main>
      <h1>Personal Schedule</h1>

      <Link href="/schedule/new">+ 予定を追加</Link>

      {state === 'error' ? (
        <StatePanel
          variant="error"
          title="予定を読み込めませんでした"
          description="通信状況を確認し、もう一度お試しください。"
        />
      ) : null}
      {state === 'empty' ? (
        <StatePanel variant="empty" title="登録されている予定はありません" />
      ) : null}

      {result.ok && result.data.length > 0 ? (
        <ul className={styles.list}>
          {result.data.map((entry) => {
            const isOwner = user !== null && entry.ownerId === user.id;
            return (
              <li key={entry.id} className={styles.item}>
                <Link href={`/schedule/${entry.id}`} className={styles.itemLink}>
                  <Badge variant={isOwner ? 'neutral' : 'info'}>
                    {isOwner ? '自分の予定' : '共有されている予定'}
                  </Badge>
                  <span className={styles.itemType}>{scheduleTypeLabel(entry.scheduleType)}</span>
                  <span className={styles.itemTemporal}>
                    {scheduleTemporalLabel(entry.temporal)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </main>
  );
}
