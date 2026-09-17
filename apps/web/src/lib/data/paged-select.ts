import type { PostgrestResponse } from "@supabase/supabase-js";
import { err, ok } from "@stage-tracker/domain";
import { classifyPostgrestError } from "./supabase-select";
import { readError } from "./read-error";
import type { ReadResult } from "./read-result";

const PAGE_SIZE = 500;

export interface KeysetReadRow {
  readonly id: string;
}

/**
 * PostgREST は `supabase/config.toml` の `api.max_rows`（既定 1000）を
 * 超える行数を silently truncate する（エラーにならず、要求より短い行数が
 * 成功応答として返る）。`.range()` でページングし、`{ count: "exact" }` が
 * 報告する総数に達するまで読み続ける。「返ってきたページが要求した
 * `PAGE_SIZE` より短かった = 最後のページ」という仮定は使わない - それは
 * `max_rows` が `PAGE_SIZE` 未満に設定された場合に破綻し、この関数が防ごう
 * としている truncation を静かに再導入する（M8 oracle の
 * `fetchAllRows` と同じ設計）。
 *
 * `queryPage` は毎回 `{ count: "exact" }` を指定した query を渡すこと
 * （指定が無いと `count` が常に `null` になり、この関数は truncation を
 * 検出できないため `failure` を返す）。
 */
export async function runPagedSupabaseSelect<Row>(
  queryPage: (from: number, to: number) => PromiseLike<PostgrestResponse<Row>>,
): Promise<ReadResult<readonly Row[]>> {
  const rows: Row[] = [];
  let offset = 0;
  for (;;) {
    let response: PostgrestResponse<Row>;
    try {
      response = await queryPage(offset, offset + PAGE_SIZE - 1);
    } catch (thrown) {
      console.error("[read] unexpected exception during paged SELECT", thrown);
      return err(readError("failure"));
    }

    if (response.error !== null) {
      return err(classifyPostgrestError(response.error, response.status));
    }
    if (response.count === null) {
      console.error(
        "[read] Supabase did not report a total row count for a paginated query (missing count: 'exact').",
      );
      return err(readError("failure"));
    }
    if (response.data === null) {
      console.error(
        "[read] Supabase returned no error but no data for a paginated SELECT query.",
      );
      return err(readError("failure"));
    }

    rows.push(...response.data);
    offset += response.data.length;
    if (offset >= response.count) {
      break;
    }

    // A short or empty page is not evidence that the read is complete. The
    // exact count says that rows still exist, so accepting this response would
    // turn a transient/truncated page into a successful partial read.
    if (response.data.length === 0) {
      console.error(
        `[read] paginated SELECT returned an empty page before its exact count was reached (received=${offset}, count=${response.count}).`,
      );
      return err(readError("failure"));
    }
  }
  return ok(rows);
}

/**
 * Read every row using an immutable UUID primary-key cursor.
 *
 * `queryPage` must order by ascending `id`, apply `id > cursor` when the
 * cursor is non-null, request at most `limit` rows, and request
 * `{ count: "exact" }`. The exact count is only completeness evidence for
 * the current qualifying set; this helper does not claim a point-in-time
 * snapshot across requests. A short page is therefore not EOF when the
 * count says that more qualifying rows remain.
 */
export async function runKeysetSupabaseSelect<Row extends KeysetReadRow>(
  queryPage: (
    cursor: string | null,
    limit: number,
  ) => PromiseLike<PostgrestResponse<Row>>,
): Promise<ReadResult<readonly Row[]>> {
  const rows: Row[] = [];
  const seenIds = new Set<string>();
  let cursor: string | null = null;

  for (;;) {
    let response: PostgrestResponse<Row>;
    try {
      response = await queryPage(cursor, PAGE_SIZE);
    } catch (thrown) {
      console.error("[read] unexpected exception during keyset SELECT", thrown);
      return err(readError("failure"));
    }

    if (response.error !== null) {
      return err(classifyPostgrestError(response.error, response.status));
    }
    if (response.count === null) {
      console.error(
        "[read] Supabase did not report a total row count for a keyset query (missing count: 'exact').",
      );
      return err(readError("failure"));
    }
    if (response.data === null) {
      console.error(
        "[read] Supabase returned no error but no data for a keyset SELECT query.",
      );
      return err(readError("failure"));
    }

    if (response.data.length === 0) {
      if (response.count === 0) {
        break;
      }
      console.error(
        `[read] keyset SELECT returned no rows while its exact count was ${response.count}; refusing to claim completeness.`,
      );
      return err(readError("failure"));
    }

    for (const row of response.data) {
      if (seenIds.has(row.id)) {
        console.error(
          `[read] keyset SELECT returned duplicate id=${row.id}; refusing to return an ambiguous list.`,
        );
        return err(readError("failure"));
      }
      seenIds.add(row.id);
      rows.push(row);
    }

    const nextCursor = response.data.at(-1)?.id;
    if (nextCursor === undefined || (cursor !== null && nextCursor <= cursor)) {
      console.error(
        "[read] keyset SELECT made no cursor progress; refusing to loop or return a partial list.",
      );
      return err(readError("failure"));
    }
    cursor = nextCursor;

    if (response.count <= response.data.length) {
      break;
    }
  }

  return ok(rows);
}
