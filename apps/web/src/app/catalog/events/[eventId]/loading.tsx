"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { buildCatalogBackHref } from "./_lib/backHref";

/**
 * `docs/v2/oracle-routes-ui.md` §1: このルートの `loading` は Client
 * Component。Next.js は `loading.tsx` に `searchParams` を渡さないため
 * （decisions.md A5 が引き継ぐ価値ありとする「pending 中も見出し/戻り先が
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
    <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-lg p-md">
      <Link
        href={backHref}
        className="w-fit text-body-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← 一覧へ戻る
      </Link>
      <p role="status" className="text-body-sm text-muted-foreground">
        読み込み中…
      </p>
    </main>
  );
}
