"use client";

import { useSearchParams } from "next/navigation";
import { BackLink, PageHeading } from "../_components/PageChrome";

/**
 * `docs/v2/oracle-routes-ui.md` §5: `page.tsx` と同一の見出し/戻り先を
 * `useSearchParams()` から再構築する（`new/loading.tsx` と同じ理由）。
 * `entryId` 自体は見出しに使わない（データ依存の見出しを先取り表示しない
 * 原則 - oracle §5「なおこの loading.tsx は『データ依存の見出しは先取り
 * して表示しない』…原則も併せ持つ」）ため `useParams()` は不要。
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
      <BackLink href={backHref}>← カレンダーへ戻る</BackLink>
      <PageHeading>予定の詳細</PageHeading>
    </div>
  );
}
