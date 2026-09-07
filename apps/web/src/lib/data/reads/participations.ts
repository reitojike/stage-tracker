import type { SupabaseClient } from "@supabase/supabase-js";
import {
  err,
  ok,
  type Event,
  type Occurrence,
  type Participation,
  type Result,
  type UserId,
} from "@stage-tracker/domain";
import {
  mapEventRow,
  mapOccurrenceRow,
  type EventRow,
  type OccurrenceRow,
} from "../mappers/eventRow";
import {
  mapParticipationRow,
  type ParticipationRow,
} from "../mappers/participationRow";
import { mapRows } from "../row-mapping";
import type { ReadResult } from "../read-result";
import { runSupabaseSelect } from "../supabase-select";

export interface ParticipationWithOccurrenceRow extends ParticipationRow {
  readonly event_occurrences:
    (OccurrenceRow & { readonly events: EventRow | null }) | null;
}

export interface ParticipationWithOccurrence {
  readonly participation: Participation;
  readonly occurrence: Occurrence;
  readonly event: Event;
}

function mapParticipationWithOccurrenceRow(
  row: ParticipationWithOccurrenceRow,
): Result<ParticipationWithOccurrence, string> {
  const participationResult = mapParticipationRow(row);
  if (!participationResult.ok) {
    return participationResult;
  }
  if (row.event_occurrences === null) {
    return err(
      `Invalid occurrence_participations row (id=${row.id}): missing embedded event_occurrences (expected inner join).`,
    );
  }
  const occurrenceResult = mapOccurrenceRow(row.event_occurrences);
  if (!occurrenceResult.ok) {
    return occurrenceResult;
  }
  if (row.event_occurrences.events === null) {
    return err(
      `Invalid occurrence_participations row (id=${row.id}): missing embedded events (expected inner join).`,
    );
  }
  const eventResult = mapEventRow(row.event_occurrences.events);
  if (!eventResult.ok) {
    return eventResult;
  }
  return ok({
    participation: participationResult.value,
    occurrence: occurrenceResult.value,
    event: eventResult.value,
  });
}

/**
 * 自分の participation を、それが属する occurrence/event と併せて読む
 * (`/` home の「直近の予定」ブロック、`/calendar` の両方が使う -
 * `docs/v2/oracle-routes-ui.md` §1 の `listMyParticipations`)。
 *
 * `user_id = userId` フィルタは `occurrence_participations` の RLS SELECT
 * policy（本人の行、または `visibility='public'` の行 -
 * `docs/v2/oracle-database.md` §2）のうち「本人の行」の部分と完全に
 * 一致する。この read は意図的に「他人の public 行」を読まないため、
 * RLS が追加で許可する範囲との差分による silent filtering は起こらず、
 * 0件は常に「本当に0件」——権限起因の unavailable が empty へ化ける余地は
 * ない（このタスクの報告「empty と unavailable をどう区別したか」参照）。
 *
 * `event_occurrences`/`events` は shared catalog（`using (true)`）なので、
 * `!inner` embed は「その occurrence/event が存在しない」というデータ
 * 整合性上の異常時にのみ行を落とす防御であり、権限による欠落は起こらない。
 *
 * 日付範囲の絞り込みはこの read の責務にしない: 呼び出し元（画面層）が
 * `@stage-tracker/domain` の `compareInstants` 等の pure 関数で絞り込む。
 * SQL 側に複雑な範囲フィルタを持ち込まず、絞り込みロジックをテスト
 * しやすい pure 関数側へ寄せる技術判断（このタスクの報告に記録する）。
 */
export async function listMyParticipations(
  client: SupabaseClient,
  userId: UserId,
): Promise<ReadResult<readonly ParticipationWithOccurrence[]>> {
  const query = client
    .from("occurrence_participations")
    .select("*, event_occurrences!inner(*, events!inner(*))")
    .eq("user_id", userId)
    .overrideTypes<ParticipationWithOccurrenceRow[]>();

  const rowsResult = await runSupabaseSelect(query);
  if (!rowsResult.ok) {
    return rowsResult;
  }
  return mapRows(rowsResult.value, mapParticipationWithOccurrenceRow);
}
