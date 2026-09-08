import type { SupabaseClient } from "@supabase/supabase-js";
import {
  err,
  groupIdSchema,
  ok,
  type Event,
  type EventClassification,
  type Genre,
  type Group,
  type GroupId,
  type Occurrence,
  type Result,
  type TokyoCalendarDate,
} from "@stage-tracker/domain";
import type { Database } from "../database.types";
import {
  mapEventRow,
  mapOccurrenceRow,
  type EventRow,
  type OccurrenceRow,
} from "../mappers/eventRow";
import {
  mapGenreRow,
  mapGroupRow,
  type GenreRow,
} from "../mappers/classificationRow";
import { mapRows } from "../row-mapping";
import type { ReadResult } from "../read-result";
import { runSupabaseSelect } from "../supabase-select";

/**
 * PR #381 review finding 1: 各 read はここで `client` を
 * `SupabaseClient<Database>` として受け取ることで、`.from(table)`/
 * `.select(query)` の table 名・column 名・embed 先の relationship を
 * 生成済み `Database` 型（`../database.types.ts`）に対して検査させる。
 * 個々の query はもう手書き `XxxRow` interface へ `overrideTypes()` で
 * 型を強制しない（詳細はこの Task の報告を参照）。`EventRow`/
 * `OccurrenceRow`/`GenreRow`/`GroupRow` 自体は変更していないが、
 * 実際に流れてくる行はこの select の実型（`Database` 由来で
 * migration 変更を検知できる）であり、それらの hand-written interface は
 * 「読み取る最小限の列」を表す下限 shape として引き続き機能する
 * （実際の行がその列を含まなくなった場合は、この関数の戻り値の型
 * 自体が壊れて typecheck が失敗する）。
 */

export interface EventCatalogRow extends EventRow {
  readonly event_occurrences: readonly OccurrenceRow[];
  readonly genres: GenreRow | null;
  readonly event_groups: readonly { readonly group_id: string }[];
}

export interface EventCatalogEntry {
  readonly event: Event;
  readonly occurrences: readonly Occurrence[];
  readonly classification: EventClassification;
}

function mapEventCatalogRow(
  row: EventCatalogRow,
): Result<EventCatalogEntry, string> {
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

  let genre: Genre | null = null;
  if (row.genres !== null) {
    const genreResult = mapGenreRow(row.genres);
    if (!genreResult.ok) {
      return genreResult;
    }
    genre = genreResult.value;
  }

  const groupIds: GroupId[] = [];
  for (const eventGroupRow of row.event_groups) {
    const parsed = groupIdSchema.safeParse(eventGroupRow.group_id);
    if (!parsed.success) {
      return err(
        `Invalid event_groups row (event_id=${row.id}): ${parsed.error.message}`,
      );
    }
    groupIds.push(parsed.data);
  }

  return ok({
    event: eventResult.value,
    occurrences,
    classification: { eventId: eventResult.value.id, genre, groupIds },
  });
}

export interface TokyoCalendarDateRange {
  readonly startsOn: TokyoCalendarDate;
  readonly endsOn: TokyoCalendarDate;
}

/**
 * `/catalog` の月表示が必要とする read
 * (`docs/v2/oracle-routes-ui.md` §1 の `listEventCatalogInRange`)。
 *
 * AGENTS.md「Catalog の日程参照要件」の2つの要件——(a) 期間内に公演回が
 * ある event を引ける、(b) 期間と Event range が重なる event を公演回の
 * 有無にかかわらず引ける——を、単一の Event range overlap フィルタ
 * (`starts_on <= endsOn AND ends_on >= startsOn`) だけで両方満たす。これは
 * 推測ではなく DB invariant から導ける: occurrence の `starts_at` の
 * Asia/Tokyo calendar date は常に親 event の `[starts_on, ends_on]` に
 * 収まる（`docs/v2/oracle-database.md` §5 invariant 4）ため、「期間内に
 * occurrence がある event」は必然的に「その event の range が期間と
 * 重なる」の部分集合であり、後者のフィルタ一発で両方をカバーできる。
 *
 * `events`/`event_occurrences`/`genres`/`event_groups` はいずれも
 * `using (true)` の shared catalog（`docs/v2/oracle-database.md` §2）
 * なので、authenticated である限り0件は常に「本当に0件」——unavailable が
 * empty へ化ける余地はない。
 */
export async function listEventCatalogInRange(
  client: SupabaseClient<Database>,
  range: TokyoCalendarDateRange,
): Promise<ReadResult<readonly EventCatalogEntry[]>> {
  const query = client
    .from("events")
    .select("*, event_occurrences(*), genres(*), event_groups(group_id)")
    .lte("starts_on", range.endsOn)
    .gte("ends_on", range.startsOn);

  const rowsResult = await runSupabaseSelect(query);
  if (!rowsResult.ok) {
    return rowsResult;
  }
  return mapRows(rowsResult.value, mapEventCatalogRow);
}

/**
 * `/catalog` のフィルタ option chain（genre）。catalog 全体で known な
 * values を返す（AGENTS.md「Filter option universe」: 表示中の月には
 * 限定しない）。`genres` は shared catalog なので0件は常に「本当に0件」。
 */
export async function listCatalogGenres(
  client: SupabaseClient<Database>,
): Promise<ReadResult<readonly Genre[]>> {
  const query = client
    .from("genres")
    .select("*")
    .order("sort_order", { ascending: true });

  const rowsResult = await runSupabaseSelect(query);
  if (!rowsResult.ok) {
    return rowsResult;
  }
  return mapRows(rowsResult.value, mapGenreRow);
}

/** `/catalog` のフィルタ option chain（group）。genre に紐づかない汎用
 * lookup 全件（AGENTS.md「Group」）。 */
export async function listCatalogGroups(
  client: SupabaseClient<Database>,
): Promise<ReadResult<readonly Group[]>> {
  const query = client
    .from("groups")
    .select("*")
    .order("display_name", { ascending: true });

  const rowsResult = await runSupabaseSelect(query);
  if (!rowsResult.ok) {
    return rowsResult;
  }
  return mapRows(rowsResult.value, mapGroupRow);
}

/**
 * `/catalog` のフィルタ option chain（venue）。`events.venue` は canonical
 * master を持たない生 text（AGENTS.md「Venue」）なので、catalog 全体の
 * 既存 venue 値を distinct に列挙する。PostgREST に `DISTINCT` を直接
 * 指定する手段が無いため、非 null な venue を全件読んでから JS 側で
 * de-duplicate する（catalog 全体の event 数が M6a 時点で大きくない想定 -
 * 将来 event 数が増えた場合は RPC 化を検討する、AGENT-level 技術判断）。
 */
export async function listCatalogVenues(
  client: SupabaseClient<Database>,
): Promise<ReadResult<readonly string[]>> {
  const query = client.from("events").select("venue").not("venue", "is", null);

  const rowsResult = await runSupabaseSelect(query);
  if (!rowsResult.ok) {
    return rowsResult;
  }

  const venues = new Set<string>();
  for (const row of rowsResult.value) {
    if (row.venue !== null) {
      venues.add(row.venue);
    }
  }
  return ok([...venues].sort((a, b) => a.localeCompare(b, "ja")));
}
