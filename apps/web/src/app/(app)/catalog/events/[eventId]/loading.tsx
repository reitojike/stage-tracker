"use client";

import { useSearchParams } from "next/navigation";
import { BackLink } from "@stage-tracker/ui";
import { buildCatalogBackHref } from "./_lib/backHref";

/**
 * This route's loading boundary is a Client Component because Next.js does
 * not pass `searchParams` to `loading.tsx`; the component therefore reads
 * the query locally so the pending view preserves the same heading/back-link
 * UX as the resolved page（decisions.md A5 が引き継ぐ価値ありとする「pending 中も見出し/戻り先が
 * 変わらない」UX を保つには、`useSearchParams` で自前に読む必要がある）。
 * `month`/`date` を保った「← 一覧へ戻る」リンクを、データ取得中も
 * 同じ場所に表示し続ける。
 *
 * データ依存の見出し（event title 等）は先取り表示しない
 * （decisions.md A5 が維持を推奨する原則）。
 */
export default function EventDetailLoading() {
  const searchParams = useSearchParams();
  const backHref = buildCatalogBackHref(
    Object.fromEntries(searchParams.entries()),
  );

  return (
    <div className="flex w-full flex-col gap-md">
      <BackLink href={backHref}>一覧へ戻る</BackLink>
      <p role="status" className="text-body-sm text-muted-foreground">
        読み込み中…
      </p>
    </div>
  );
}
