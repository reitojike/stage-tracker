"use client";

import { useSearchParams } from "next/navigation";
import { tokyoCalendarDateSchema } from "@stage-tracker/domain";
import { BackLink, PageHeading } from "../_components/PageChrome";

/**
 * `loading.tsx` is a Client Component because Next.js does not pass
 * `params`/`searchParams` to it; it reconstructs the same `page.tsx` and
 * 同一の見出し/戻り先を Client Component 側で `useSearchParams()` から
 * 再構築する（レイアウトシフト防止）。`page.tsx` の
 * `resolvePrefillDate` と同じ判定をここでも行い、`?date=` の有無・妥当性で
 * 戻り先だけがブレないようにする。
 */
export default function NewScheduleLoading() {
  const searchParams = useSearchParams();
  const rawDate = searchParams.get("date");
  const prefillDate =
    rawDate !== null && tokyoCalendarDateSchema.safeParse(rawDate).success
      ? rawDate
      : null;
  const backHref = prefillDate ? `/calendar?date=${prefillDate}` : "/calendar";

  return (
    <div className="flex flex-col gap-4">
      <BackLink href={backHref}>カレンダーへ戻る</BackLink>
      <PageHeading>予定を追加</PageHeading>
    </div>
  );
}
