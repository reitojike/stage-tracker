import type { PostgrestResponse } from "@supabase/supabase-js";
import { err, ok } from "@stage-tracker/domain";
import { classifyPostgrestError } from "./supabase-select";
import { readError } from "./read-error";
import type { ReadResult } from "./read-result";

const PAGE_SIZE = 500;

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
    if (response.data.length === 0 || offset >= response.count) {
      break;
    }
  }
  return ok(rows);
}
