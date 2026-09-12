"use client";

import { useSearchParams } from "next/navigation";
import { tokyoCalendarDateSchema } from "@stage-tracker/domain";
import { BackLink, PageHeading } from "../_components/PageChrome";

/**
 * `docs/v2/oracle-routes-ui.md` §5: `loading.tsx` は Next.js が
 * `params`/`searchParams` を渡さない制約への対処として、`page.tsx` と
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
