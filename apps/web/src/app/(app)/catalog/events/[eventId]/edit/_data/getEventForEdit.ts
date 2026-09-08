import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ok,
  type Event,
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
 * `/catalog/events/[eventId]/edit` が必要とする event+occurrences の read
 * （`docs/v2/oracle-routes-ui.md` §1 の `getEventWithOccurrences`）。
 * `apps/web/src/lib/data/` は変更禁止（read boundary は完成済み）だが、
 * その boundary が export する mapper/utility（`@stage-tracker/ui` 側の
 * `StatePanel` と対になる `ReadResult`/`classifyListReadResult` 等）は
 * そのまま再利用できる。
 *
 * `readonly EventForEdit[]`（0 or 1 件）を返す設計にすることで、既存の
 * `classifyListReadResult`（`@/lib/data`）をそのまま使い回し、
 * 「fetch 失敗 -> error/unavailable」「0件 -> empty（= 指定 event が
 * 存在しない）」の3分岐をこの read 専用に作り直さない。
 */
export interface EventForEdit {
  readonly event: Event;
  readonly occurrences: readonly Occurrence[];
}

interface EventForEditRow extends EventRow {
  readonly event_occurrences: readonly OccurrenceRow[];
}

function mapEventForEditRow(
  row: EventForEditRow,
): Result<EventForEdit, string> {
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
  return ok({ event: eventResult.value, occurrences });
}

export async function getEventForEdit(
  client: SupabaseClient,
  eventId: string,
): Promise<ReadResult<readonly EventForEdit[]>> {
  const query = client
    .from("events")
    .select("*, event_occurrences(*)")
    .eq("id", eventId)
    .order("starts_at", {
      foreignTable: "event_occurrences",
      ascending: true,
    })
    .overrideTypes<EventForEditRow[]>();

  const rowsResult = await runSupabaseSelect(query);
  if (!rowsResult.ok) {
    return rowsResult;
  }
  return mapRows(rowsResult.value, mapEventForEditRow);
}
