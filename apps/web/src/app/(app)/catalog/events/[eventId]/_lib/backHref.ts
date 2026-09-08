export type CatalogSearchParams = Record<string, string | string[] | undefined>;

/**
 * `/catalog` へ戻るリンクの構築。event 詳細への遷移元
 * (`docs/v2/oracle-routes-ui.md` §1 の `searchParams: month, date`) が
 * どの月/日を見ていたかを保つ。値が無い、または配列（多重指定）の場合は
 * 単に付けない（`/catalog` の既定表示にフォールバック）。
 */
export function buildCatalogBackHref(
  searchParams: CatalogSearchParams,
): string {
  const params = new URLSearchParams();
  const month = searchParams.month;
  const date = searchParams.date;
  if (typeof month === "string" && month.length > 0) {
    params.set("month", month);
  }
  if (typeof date === "string" && date.length > 0) {
    params.set("date", date);
  }
  const query = params.toString();
  return query.length > 0 ? `/catalog?${query}` : "/catalog";
}
