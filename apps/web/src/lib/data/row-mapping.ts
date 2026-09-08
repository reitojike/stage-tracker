import { err, ok, type Result } from "@stage-tracker/domain";
import { readError } from "./read-error";
import type { ReadResult } from "./read-result";

/**
 * A10 (`docs/v2/decisions.md`): pre-v2 の `mapXRow` 系は pure boundary 内で
 * `throw` していた（zod の `.parse()` を使っていたため）。周囲が全て
 * `Result` 規約なのに、ここだけ例外が boundary を突き破っていた。
 *
 * v2 の決定: 個々の row mapper は **決して throw しない**契約にする
 * （`.safeParse()` を使い、`Result<T, string>` を返す）。1行でも mapping
 * に失敗した場合、その bulk read 全体を `failure` として扱い、
 * **サイレントに間引かない**（「読めない行はスキップ」は採らなかった）。
 *
 * 理由:
 *
 * 1. mapping 失敗は RLS 由来ではなく、スキーマ不整合・生成型との drift・
 *    想定外の null 等、データ層自体のバグを意味する。バグを握りつぶす
 *    設計にしない。
 * 2. 「失敗した行だけを黙って間引く」設計は、母集団によっては「全行が
 *    mapping に失敗した」ケースが 0 件成功として返り、`empty` へ
 *    化ける。これはこの Task 全体が防ごうとしている「RLS の
 *    unavailable が empty へ化ける」バグと**原因は違うが結果として
 *    全く同じ害**を持つ。読めない理由が権限であれデータ破損であれ、
 *    「本当は行があるのに empty に見える」ことを防ぐのがこの boundary の
 *    仕事である以上、mapping 層だけ例外的に間引きを許す理由がない。
 * 3. 一部だけ失敗するケースも、無言で欠落させると「実際には存在するが
 *    画面に出ない行」を生み、ユーザーから見て権限問題との区別が
 *    つかなくなる。
 *
 * したがって 1件でも失敗したら bulk 全体を `err` にし、呼び出し元
 * （`reads/*.ts`）へ明示的に伝える。個々の row mapper 自体は
 * `mappers/*.ts` で単体 export し、再利用・単体テストできるようにする。
 */
export function mapRows<Row, T>(
  rows: readonly Row[],
  mapRow: (row: Row) => Result<T, string>,
): ReadResult<readonly T[]> {
  const mapped: T[] = [];
  for (const row of rows) {
    const result = mapRow(row);
    if (!result.ok) {
      // The mapper's own failure string names the offending row/column
      // shape (schema drift, unexpected null, ...) - genuinely useful for
      // debugging a data-layer bug, but not something to hand to the UI
      // (PR #381 review finding 2; `readError()` no longer accepts a
      // message parameter at all - see `./read-error.ts`).
      console.error("[read] row mapping failed", result.error);
      return err(readError("failure"));
    }
    mapped.push(result.value);
  }
  return ok(mapped);
}
