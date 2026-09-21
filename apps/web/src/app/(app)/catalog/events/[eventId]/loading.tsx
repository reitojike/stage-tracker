"use client";

import { useSearchParams } from "next/navigation";
import { BackLink } from "@stage-tracker/ui";
import { buildCatalogBackHref } from "./_lib/backHref";

/**
 * This loading boundary owns the pending-state presentation for the event
 * detail route. Because Next.js does not pass `searchParams` to
 * `loading.tsx`, the component reads them locally so the month/date-aware
 * back link remains stable while data is loading.
 *
 * データ依存の見出し（event title 等）は先取り表示しない
 * Data-dependent headings are not shown before the event has been read.
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
