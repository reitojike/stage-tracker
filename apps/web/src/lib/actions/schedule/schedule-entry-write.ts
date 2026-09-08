import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PersonalScheduleEntry,
  PersonalScheduleEntryId,
  PersonalScheduleEntryTemporal,
  UserId,
} from "@stage-tracker/domain";
import {
  mapPersonalScheduleEntryRow,
  type PersonalScheduleEntryRow,
} from "@/lib/data";
import { ActionError } from "@/lib/action-error";
import { classifyWritePostgrestError } from "./postgrest-error";

/**
 * `personal_schedule_entries` の write 層（`docs/v2/oracle-routes-ui.md` §1
 * の `createScheduleEntryAction` / `updateScheduleEntryAction` /
 * `deleteScheduleEntryAction` が呼ぶ Supabase 呼び出し本体）。
 *
 * `apps/web/src/lib/data/reads/personalSchedule.ts` と対になる write 版だが、
 * このタスクの制約で `lib/data/` 配下には置けない
 * （「apps/web/src/lib/data/ は変更しないこと」）ため、書き込み層として
 * 新設した `lib/actions/schedule/` に置く。行 mapper
 * （`mapPersonalScheduleEntryRow`）は read boundary のものをそのまま import
 * して再利用する - insert/update の `.select()` レスポンスも、read が返す
 * のと全く同じ行形状だから。
 *
 * 例外で失敗を伝える設計（`Result` を返さない）: これらの関数は常に
 * `next-safe-action` の `.action()` 本体から呼ばれ、投げた `ActionError` は
 * `src/lib/safe-action.ts` の `handleServerError` がそのまま
 * `ActionErrorShape` へ変換する。read boundary が `Result` を返す設計に
 * したのは「例外で境界を突き破らせない」ためだが、Server Action の境界は
 * `next-safe-action` 自身がその役割を担っており、二重に `Result` へ
 * 包む理由がない。
 */
export interface ScheduleEntryWriteFields {
  readonly title: string;
  readonly memo: string | null;
  readonly blocking: boolean;
  readonly temporal: PersonalScheduleEntryTemporal;
}

function temporalToColumns(temporal: PersonalScheduleEntryTemporal): {
  is_all_day: boolean;
  starts_on: string | null;
  ends_on: string | null;
  starts_at: string | null;
  ends_at: string | null;
} {
  if (temporal.kind === "all-day") {
    return {
      is_all_day: true,
      starts_on: temporal.startsOn,
      ends_on: temporal.endsOn,
      starts_at: null,
      ends_at: null,
    };
  }
  return {
    is_all_day: false,
    starts_on: null,
    ends_on: null,
    starts_at: temporal.startsAt,
    ends_at: temporal.endsAt,
  };
}

function mapRowOrThrow(row: PersonalScheduleEntryRow): PersonalScheduleEntry {
  const mapped = mapPersonalScheduleEntryRow(row);
  if (!mapped.ok) {
    // A10 と同じ理由で、mapping 失敗を沈黙させず `failure` として扱う。
    // ただしここは書き込み直後の読み戻しであり、原因は「書き込み自体は
    // 成功したが、その結果を domain 形へ変換できない」というデータ層の
    // バグに限られる（write 前に scheduleEntryFormSchema が既に妥当性を
    // 検証済みのため）。
    throw new ActionError("failure", "保存内容の読み戻しに失敗しました。");
  }
  return mapped.value;
}

/**
 * `.single()` を使わない理由: Database 型が未配線のこの client
 * （`src/lib/supabase/server.ts` の doc comment参照）では、
 * `.select().single().overrideTypes<Row, {merge:false}>()` の型推論が
 * 素直に解決せず（`overrideTypes` が array-vs-object の不一致を検出して
 * placeholder のエラー型を返す）、実行時には問題なくても型チェックが
 * 通らない。read boundary（`lib/data/reads/personalSchedule.ts`）が
 * 実証済みの「配列のまま `.overrideTypes<Row[]>()` する」パターンに
 * 揃え、1行目を自前で取り出す。
 */
export async function insertPersonalScheduleEntry(
  client: SupabaseClient,
  ownerId: UserId,
  fields: ScheduleEntryWriteFields,
): Promise<PersonalScheduleEntry> {
  const { data, error, status } = await client
    .from("personal_schedule_entries")
    .insert({
      owner_id: ownerId,
      title: fields.title,
      memo: fields.memo,
      blocking: fields.blocking,
      ...temporalToColumns(fields.temporal),
    })
    .select()
    .overrideTypes<PersonalScheduleEntryRow[]>();

  if (error !== null) {
    throw classifyWritePostgrestError(error, status);
  }
  const row = data[0];
  if (row === undefined) {
    throw new ActionError("failure", "作成した予定を読み戻せませんでした。");
  }
  return mapRowOrThrow(row);
}

export async function updatePersonalScheduleEntry(
  client: SupabaseClient,
  entryId: PersonalScheduleEntryId,
  fields: ScheduleEntryWriteFields,
): Promise<PersonalScheduleEntry> {
  const { data, error, status } = await client
    .from("personal_schedule_entries")
    .update({
      title: fields.title,
      memo: fields.memo,
      blocking: fields.blocking,
      ...temporalToColumns(fields.temporal),
    })
    .eq("id", entryId)
    .select()
    .overrideTypes<PersonalScheduleEntryRow[]>();

  if (error !== null) {
    throw classifyWritePostgrestError(error, status);
  }
  const row = data[0];
  if (row === undefined) {
    // 0 行更新 - RLS の owner-only UPDATE policy により、存在しない
    // entryId と「所有していない entry」の両方がここに合流する
    // （`postgrest-error.ts` の doc comment のとおり意図的）。
    throw new ActionError("not-found", "対象が見つかりませんでした。");
  }
  return mapRowOrThrow(row);
}

/**
 * owner-only hard delete（product-rules.md「Deletion」節）。
 * `personal_schedule_shares` への cascade は DB 側の `ON DELETE CASCADE`
 * が担う（`20260826000000_personal_schedule_title_blocking.sql`）ため、
 * ここでは対象 entry 自体の削除だけを行う。
 */
export async function deletePersonalScheduleEntry(
  client: SupabaseClient,
  entryId: PersonalScheduleEntryId,
): Promise<void> {
  const { data, error, status } = await client
    .from("personal_schedule_entries")
    .delete()
    .eq("id", entryId)
    .select("id")
    .overrideTypes<{ id: string }[]>();

  if (error !== null) {
    throw classifyWritePostgrestError(error, status);
  }
  // DELETE は `.single()` を使わないため PGRST116 は発生しない - 0 行
  // 削除でも PostgREST は 200 を返す。存在しない/所有していない entryId は
  // ここで明示的に検出し、update と同じ `not-found` へ畳み込む。
  if (data.length === 0) {
    throw new ActionError("not-found", "対象の予定が見つかりませんでした。");
  }
}
