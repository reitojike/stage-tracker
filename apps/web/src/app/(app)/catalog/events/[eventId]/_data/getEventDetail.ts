import type { SupabaseClient } from "@supabase/supabase-js";
import {
  compareInstants,
  ok,
  type Event,
  type EventId,
  type Occurrence,
  type Result,
} from "@stage-tracker/domain";
import {
  mapEventRow,
  mapOccurrenceRow,
  mapRows,
  runSupabaseSelect,
  type EventRow,
  type OccurrenceRow,
  type ReadResult,
} from "@/lib/data";

/**
 * `/catalog/events/[eventId]` 専用の event 詳細 read
 * (`docs/v2/oracle-routes-ui.md` §1 の `getEventWithOccurrences`)。
 *
 * このタスクの制約により `apps/web/src/lib/data/` は変更禁止であり、
 * かつそこには単一 event を ID 指定で読む read が存在しない
 * （catalog 一覧 read は月範囲、participation read は自分の全参加のみ）。
 * そのため、この route 専用に `lib/data` が export 済みの mapper /
 * `runSupabaseSelect` / `mapRows` プリミティブだけを使って合成する
 * （`lib/data/reads/catalog.ts` の `listEventCatalogInRange` と同じ
 * 合成パターンを、範囲フィルタではなく ID フィルタで踏襲する）。
 */
export interface EventDetailRow extends EventRow {
  readonly event_occurrences: readonly OccurrenceRow[];
}

export interface EventDetail {
  readonly event: Event;
  readonly occurrences: readonly Occurrence[];
}

function mapEventDetailRow(row: EventDetailRow): Result<EventDetail, string> {
  const eventResult = mapEventRow(row);
  if (!eventResult.ok) {
    return eventResult;
  }

  const occurrences: Occurrence[] = [];
  for (const occurrenceRow of row.event_occurrences) {
    const occurrenceResult = mapOccurrenceRow(occurrenceRow);
    if (!occurrenceResult.ok) {
      return occurrenceResult;
    }
    occurrences.push(occurrenceResult.value);
  }
  // AGENTS.md「Catalog の日程参照要件」: 「ある event について、その公演回を
  // 日時順に引ける」。ここで一度だけ並べ替え、呼び出し元
  // (`page.tsx`)・テストの双方が並べ替え済みの前提で書けるようにする。
  occurrences.sort((a, b) => compareInstants(a.startsAt, b.startsAt));

  return ok({ event: eventResult.value, occurrences });
}

/**
 * event を ID で1件読む。0/1 件の配列として返し、呼び出し元が
 * `classifyListReadResult` へそのまま渡せるようにする——「指定された event
 * が存在しない」は RLS 由来の unavailable ではなく本当の0件
 * (`events` は `using (true)` の shared catalog、`docs/v2/oracle-database.md`
 * §2) なので、この分類で「見つからない」(`empty`) と「読み込み失敗」
 * (`unavailable`/`error`) を正しく区別できる。
 */
export async function getEventWithOccurrences(
  client: SupabaseClient,
  eventId: EventId,
): Promise<ReadResult<readonly EventDetail[]>> {
  const query = client
    .from("events")
    .select("*, event_occurrences(*)")
    .eq("id", eventId)
    .overrideTypes<EventDetailRow[]>();

  const rowsResult = await runSupabaseSelect(query);
  if (!rowsResult.ok) {
    return rowsResult;
  }
  return mapRows(rowsResult.value, mapEventDetailRow);
}
