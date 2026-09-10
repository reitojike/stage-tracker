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
  type GroupRow,
} from "../mappers/classificationRow";
import { mapRows } from "../row-mapping";
import { readError } from "../read-error";
import type { ReadResult } from "../read-result";
import { runSupabaseSelect } from "../supabase-select";
import { runPagedSupabaseSelect } from "../paged-select";

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

interface EventGroupGroupRow {
  readonly groups: GroupRow;
}

/**
 * `/catalog` のフィルタ option chain（genre ごとの group）。group の
 * canonical identity は genre へ hard-bind されないが（AGENTS.md
 * 「Group」）、「この genre に関連する group」は、その genre の Event に
 * 実際に associate されている group から動的に導出する、と同じ節が定める
 * とおり、この読み方は `genreId` にスコープする（M8 で確定した v2 の
 * 不具合の修正 - 旧実装は genre を無視して全 group を返していた）。
 * catalog 全体が対象で、表示中の月には限定しない
 * （AGENTS.md「Filter option universe」）。
 *
 * `event_groups` の該当行数（group 数ではなく Event-group 関連の延べ数）が
 * `supabase/config.toml` の `api.max_rows` を超えると PostgREST は silently
 * truncate するため、`runPagedSupabaseSelect` で全件読む（レビュー指摘:
 * group 数自体より先にこの延べ数が上限へ達し得る）。
 */
export async function listCatalogGroups(
  client: SupabaseClient<Database>,
  genreId: string,
): Promise<ReadResult<readonly Group[]>> {
  const rowsResult = await runPagedSupabaseSelect((from, to) =>
    client
      .from("event_groups")
      .select("groups(*), events!inner(genre_id)", { count: "exact" })
      .eq("events.genre_id", genreId)
      .order("event_id", { ascending: true })
      .order("group_id", { ascending: true })
      .range(from, to),
  );
  if (!rowsResult.ok) {
    return rowsResult;
  }

  const byId = new Map<string, Group>();
  for (const row of rowsResult.value as readonly EventGroupGroupRow[]) {
    const groupResult = mapGroupRow(row.groups);
    if (!groupResult.ok) {
      console.error("[read] row mapping failed", groupResult.error);
      return err(readError("failure"));
    }
    byId.set(groupResult.value.id, groupResult.value);
  }
  return ok(
    [...byId.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName, "ja"),
    ),
  );
}

/**
 * カード上の group バッジ表示用（`listCatalogGroups` とは別の目的 - M8
 * journey 比較で確定した分類2の修正、codex review 指摘）。
 * `listCatalogGroups` は genre の group facet が active な genre だけを
 * 対象にスコープするため（Gate A facet 表: 宝塚/アイドルのみ）、venue
 * facet の genre（歌舞伎）に属しつつ `group` association も持つ Event が
 * あった場合、その group はフィルタ option chain 経由では一切解決されず
 * バッジが黙って欠落する。group の canonical identity は genre へ
 * hard-bind されない（AGENTS.md「Group」）ため、この読み方は genre に
 * 一切スコープせず、呼び出し元が実際にロード済みの Event 群から集めた
 * `groupIds` をそのまま `id IN (...)` で引く - catalog 全体を舐めるより
 * 安価かつ、facet の有無に依存しない。
 */
export async function listGroupsByIds(
  client: SupabaseClient<Database>,
  groupIds: readonly GroupId[],
): Promise<ReadResult<readonly Group[]>> {
  if (groupIds.length === 0) {
    return ok([]);
  }
  const query = client.from("groups").select("*").in("id", groupIds);
  const rowsResult = await runSupabaseSelect(query);
  if (!rowsResult.ok) {
    return rowsResult;
  }
  return mapRows(rowsResult.value as readonly GroupRow[], mapGroupRow);
}

/**
 * `/catalog` のフィルタ option chain（genre ごとの venue）。`events.venue`
 * は canonical master を持たない生 text（AGENTS.md「Venue」）なので、
 * `genreId` の Event が持つ既存 venue 値を distinct に列挙する（M8 で確定
 * した v2 の不具合の修正 - 旧実装は genre を無視して catalog 全体の venue
 * を返していた）。PostgREST に `DISTINCT` を直接指定する手段が無いため、
 * 非 null な venue を全件読んでから JS 側で de-duplicate する（catalog
 * 全体の event 数が M6a 時点で大きくない想定 - 将来 event 数が増えた場合は
 * RPC 化を検討する、AGENT-level 技術判断）。`listCatalogGroups` と同じ
 * truncation hazard があるため `runPagedSupabaseSelect` で全件読む。
 */
export async function listCatalogVenues(
  client: SupabaseClient<Database>,
  genreId: string,
): Promise<ReadResult<readonly string[]>> {
  const rowsResult = await runPagedSupabaseSelect((from, to) =>
    client
      .from("events")
      .select("venue", { count: "exact" })
      .eq("genre_id", genreId)
      .not("venue", "is", null)
      .order("id", { ascending: true })
      .range(from, to),
  );
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
