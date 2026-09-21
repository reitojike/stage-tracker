"use client";

import { useSearchParams } from "next/navigation";
import { BackLink, PageHeading } from "../_components/PageChrome";

/**
 * Reconstruct the same heading/back link as `page.tsx` from
 * `useSearchParams()` because Next.js does not pass query params to
 * `loading.tsx` (the same reason as `new/loading.tsx`).
 * `entryId` 自体は見出しに使わない（データ依存の見出しを先取り表示しない
 * 原則 - data-dependent headings are not shown before the page resolves）ため
 * `useParams()` は不要。
 */
export default function ScheduleEntryDetailLoading() {
  const searchParams = useSearchParams();
  const month = searchParams.get("month");
  const backHref =
    month !== null && month.length > 0
      ? `/calendar?month=${month}`
      : "/calendar";

  return (
    <div className="flex flex-col gap-4">
      <BackLink href={backHref}>カレンダーへ戻る</BackLink>
      <PageHeading>予定の詳細</PageHeading>
    </div>
  );
}
