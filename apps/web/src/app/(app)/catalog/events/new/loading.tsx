"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { BackLink } from "@stage-tracker/ui";

/**
 * `loading.tsx` is a Client Component because Next.js does not pass `params`/
 * `searchParams` to it; `useSearchParams` reconstructs the back link
 * (`month`/`date`) while the page is pending so the resolved and loading views
 * 再構築する。データ依存の見出しは先取りして表示しない
 * （権限判定前の見出しを出さない）。
 *
 * `useSearchParams()` を呼ぶ部分は専用の `Suspense` 境界に切り出す。
 * `next build` の static generation は `useSearchParams()` の呼び出し元に
 * それ自身の `Suspense` boundary を要求する
 * （https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout） —
 * `loading.tsx` 自体が親 route の Suspense fallback であることはこの
 * 要件を免除しない。
 */
function BackToCatalogLink() {
  const searchParams = useSearchParams();
  const month = searchParams.get("month");
  const date = searchParams.get("date");

  const query = new URLSearchParams();
  if (month !== null) {
    query.set("month", month);
  }
  if (date !== null) {
    query.set("date", date);
  }
  const qs = query.toString();
  const backHref = qs.length > 0 ? `/catalog?${qs}` : "/catalog";

  return <BackLink href={backHref}>イベントカタログへ戻る</BackLink>;
}

export default function NewEventLoading() {
  return (
    <>
      <Suspense
        fallback={<BackLink href="/catalog">イベントカタログへ戻る</BackLink>}
      >
        <BackToCatalogLink />
      </Suspense>
      <p role="status" className="text-body-sm text-muted-foreground">
        読み込み中…
      </p>
    </>
  );
}
