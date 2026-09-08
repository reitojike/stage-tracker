import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PersonalScheduleEntry,
  PersonalScheduleEntryId,
} from "@stage-tracker/domain";
import { listVisiblePersonalSchedule, type ReadResult } from "@/lib/data";
import { ok } from "@stage-tracker/domain";

/**
 * `/schedule/[entryId]` と `/schedule/[entryId]/edit` が共有する、
 * 単一 entry の可視性チェック付き lookup。
 *
 * `apps/web/src/lib/data/` は変更禁止のためこのタスクでは触れない
 * （read boundary は完成済み）。そこには単一 entry 用の `getBy(id)` は
 * まだ無く、一覧専用の `listVisiblePersonalSchedule` だけが存在する。
 * このタスクでは新しい read boundary 関数を `lib/data/` へ追加する
 * 代わりに、既存の一覧 read をそのまま再利用してこの feature-local な
 * `_lib/` で `.find(id)` する設計を選んだ - 理由は次の2点:
 *
 * 1. `listVisiblePersonalSchedule` は明示的な owner/share フィルタを
 *    持たず、RLS の可視範囲（owner本人 OR 自分宛の share）にそのまま
 *    委ねている。この一覧に entryId が含まれないことは、「そもそも
 *    存在しない」か「存在するが自分に見えない（非公開）」のどちらか
 *    であり、区別できない。これは oracle-routes-ui.md §2 予定詳細が
 *    明示する「存在しない/非公開は同一の empty 扱い（RLS が区別不能に
 *    しているため意図的に一体化）」と**まさに同じ設計**であり、
 *    新しい ID 指定 read を別途作るより、この既存 read の可視性契約を
 *    再利用する方が一貫性が高い。
 * 2. 新しい read boundary 関数（`getVisiblePersonalScheduleEntry`
 *    相当）を追加するには `lib/data/` の変更が要るが、それはこの
 *    タスクの制約で禁止されている。
 *
 * トレードオフ（このタスクの報告に記録）: 詳細画面1件のためだけに
 * 呼び出し元の全件を読む。personal schedule の想定規模（個人の予定表）
 * では問題にならない前提だが、read boundary 側に ID 指定の専用 read を
 * 追加する方が本来は望ましく、次の Task で検討する価値がある。
 */
export async function findVisibleScheduleEntry(
  client: SupabaseClient,
  entryId: PersonalScheduleEntryId,
): Promise<ReadResult<PersonalScheduleEntry | null>> {
  const listResult = await listVisiblePersonalSchedule(client);
  if (!listResult.ok) {
    return listResult;
  }
  const found = listResult.value.find((entry) => entry.id === entryId) ?? null;
  return ok(found);
}
