"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

/**
 * `docs/v2/oracle-routes-ui.md` §1/§5: `loading.tsx` は `params`/
 * `searchParams` を受け取れない Next.js の制約への対処として Client
 * Component 化し、`useSearchParams` で戻り先（`month`/`date`）を
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

  return (
    <Link
      href={backHref}
      className="text-body-sm text-muted-foreground hover:text-foreground"
    >
      ← イベントカタログへ戻る
    </Link>
  );
}

export default function NewEventLoading() {
  return (
    <>
      <Suspense
        fallback={
          <Link
            href="/catalog"
            className="text-body-sm text-muted-foreground hover:text-foreground"
          >
            ← イベントカタログへ戻る
          </Link>
        }
      >
        <BackToCatalogLink />
      </Suspense>
      <p role="status" className="text-body-sm text-muted-foreground">
        読み込み中…
      </p>
    </>
  );
}
