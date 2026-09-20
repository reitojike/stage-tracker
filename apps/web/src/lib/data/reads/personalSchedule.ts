import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ok,
  type PersonalScheduleEntry,
  type PersonalScheduleEntryId,
} from "@stage-tracker/domain";
import type { Database } from "../database.types";
import { mapPersonalScheduleEntryRow } from "../mappers/scheduleEntryRow";
import { mapRows } from "../row-mapping";
import type { ReadResult } from "../read-result";
import { runKeysetSupabaseSelect } from "../paged-select";
import { runSupabaseSelect } from "../supabase-select";

async function listPersonalScheduleRows(client: SupabaseClient<Database>) {
  return runKeysetSupabaseSelect((cursor, limit) => {
    const query = client
      .from("personal_schedule_entries")
      .select("*", { count: "exact" });
    const afterCursor = cursor === null ? query : query.gt("id", cursor);
    return afterCursor.order("id", { ascending: true }).limit(limit);
  });
}

/**
 * 自分に見える personal schedule entry（owner本人 + 自分宛に共有された
 * もの）を読む（`/` home、`/calendar` が使う -
 * `docs/v2/oracle-routes-ui.md` §1 の `listVisiblePersonalSchedule`)。
 *
 * 明示的な owner/share フィルタを一切かけない: RLS の SELECT policy
 * (`personal_schedule_entries_select_owner_or_shared` - owner本人 OR
 * 自分宛の share がある、`docs/v2/oracle-database.md` §2) が「この
 * caller に見えるべき行」を過不足なく定義しており、この read の意図
 * （「自分に見える予定を全部見たい」）と RLS の可視範囲が完全に一致する。
 * したがって0件は常に「本当に0件」であり、unavailable が empty へ化ける
 * 余地はない（このタスクの報告「empty と unavailable をどう区別したか」
 * 参照）。
 *
 * 日付範囲の絞り込みはこの read の責務にしない
 * （`./participations.ts` の同様の注記を参照）。加えてこのテーブルは
 * all-day/time-bounded の2形状が混在する（`is_all_day` +
 * `starts_on`/`ends_on` または `starts_at`/`ends_at`）ため、単一の
 * `.gte`/`.lte` だけでは両形状を正しく範囲判定できず、PostgREST の
 * `.or()` で複合条件を組む必要がある。今回はその複雑さを持ち込まず、
 * 呼び出し元が `PersonalScheduleEntry.temporal`（discriminated union）を
 * 見て pure に絞り込む設計にした（このタスクの報告に技術判断として
 * 記録する）。
 */
export async function listVisiblePersonalSchedule(
  client: SupabaseClient<Database>,
): Promise<ReadResult<readonly PersonalScheduleEntry[]>> {
  const rowsResult = await listPersonalScheduleRows(client);
  if (!rowsResult.ok) {
    return rowsResult;
  }
  return mapRows(rowsResult.value, mapPersonalScheduleEntryRow);
}

/**
 * Read one entry from the caller's RLS-visible schedule.
 *
 * The ID predicate keeps detail/edit reads bounded while leaving visibility to
 * the same `personal_schedule_entries` SELECT policy as the list read. RLS
 * therefore makes an invisible row look exactly like an absent row: both
 * produce a successful empty result and are returned as `null`.
 */
export async function getVisiblePersonalScheduleEntry(
  client: SupabaseClient<Database>,
  entryId: PersonalScheduleEntryId,
): Promise<ReadResult<PersonalScheduleEntry | null>> {
  const rowsResult = await runSupabaseSelect(
    client
      .from("personal_schedule_entries")
      .select("*")
      .eq("id", entryId)
      .limit(1),
  );
  if (!rowsResult.ok) {
    return rowsResult;
  }

  const mappedResult = mapRows(rowsResult.value, mapPersonalScheduleEntryRow);
  if (!mappedResult.ok) {
    return mappedResult;
  }
  return ok(mappedResult.value[0] ?? null);
}
