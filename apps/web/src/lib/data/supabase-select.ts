import type { PostgrestError, PostgrestResponse } from "@supabase/supabase-js";
import { err, ok } from "@stage-tracker/domain";
import { readError, type ReadError } from "./read-error";
import type { ReadResult } from "./read-result";

/**
 * `docs/v2/oracle-database.md` §0 のカスタム SQLSTATE 慣習: `42501`
 * （insufficient_privilege）は「権限が無い、または存在しない/所有して
 * いないことを意図的に区別しない」ケースに使われる唯一の permission 系
 * コードである。RLS の row-level policy（`using` 句）が行を除外する場合は
 * Postgres が一切エラーを返さず、単に0件の成功として応答するため、ここに
 * 現れることはない - それこそが「RLS は権限の無い行を存在しないように
 * 見せる」の実体であり、この関数のレベルでは検出しようがない。この
 * read boundary が保証できるのは「table-level grant が無い、または
 * PostgREST/GoTrue が明示的に権限拒否を返したケースを、silent success
 * へ潰さないこと」までである（詳細はこの Task の報告の
 * 「empty と unavailable をどう区別したか」を参照）。
 */
const PERMISSION_DENIED_POSTGRES_CODES: ReadonlySet<string> = new Set([
  "42501",
]);

export function classifyPostgrestError(
  error: PostgrestError,
  status: number,
): ReadError {
  if (status === 401) {
    return readError("unauthenticated");
  }
  if (status === 403 || PERMISSION_DENIED_POSTGRES_CODES.has(error.code)) {
    return readError("permission-denied");
  }
  // Unclassified PostgREST failure - same shape as
  // `@/lib/safe-action.ts`'s `toActionErrorShape`: log the raw detail
  // (table/constraint names, SQL error text) for server-side forensics only,
  // never fold it into the `ReadError` returned to the caller (review
  // finding 2 on PR #381 - `readError()` no longer even accepts a message
  // parameter, see `./read-error.ts`).
  console.error("[read] unclassified PostgREST error", {
    status,
    code: error.code,
    message: error.message,
  });
  return readError("failure");
}

/**
 * PostgREST への1回の SELECT 呼び出しを `ReadResult` へ変換する、この
 * read boundary で唯一の「fetch 失敗の意味を判定する」場所。個々の
 * `reads/*.ts` はここを経由することで分類ロジックを重複させない。
 *
 * fetch 自体の例外（ネットワーク断、fetch() の reject）も `Result` へ
 * 畳み込み、呼び出し側が try/catch を書く必要をなくす
 * （「すべての read が Result を返し、例外で boundary を突き破らせない」
 * という絶対要件）。
 */
export async function runSupabaseSelect<Row>(
  query: PromiseLike<PostgrestResponse<Row>>,
): Promise<ReadResult<readonly Row[]>> {
  let response: PostgrestResponse<Row>;
  try {
    response = await query;
  } catch (thrown) {
    // Network exception (fetch reject等) - the thrown value's own message
    // is runtime/network-specific and must not reach the client (review
    // finding 2 on PR #381); log it server-side only.
    console.error("[read] unexpected exception during SELECT", thrown);
    return err(readError("failure"));
  }

  if (response.error !== null) {
    return err(classifyPostgrestError(response.error, response.status));
  }
  // PostgREST は成功した SELECT に対して常に JSON 配列 body を返すため
  // `data` は実質 non-null。この null チェックは型を満たすためと、
  // 想定外の client/runtime 異常に対する防御でしかない。
  if (response.data === null) {
    console.error(
      "[read] Supabase returned no error but no data for a SELECT query.",
    );
    return err(readError("failure"));
  }
  return ok(response.data);
}
