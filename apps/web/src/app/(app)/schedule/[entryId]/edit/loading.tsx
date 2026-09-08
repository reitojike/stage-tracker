"use client";

import { useSearchParams } from "next/navigation";
import { BackLink, PageHeading } from "../../_components/PageChrome";

/** `[entryId]/loading.tsx` と同じ理由・同じ実装方針。 */
export default function EditScheduleEntryLoading() {
  const searchParams = useSearchParams();
  const month = searchParams.get("month");
  const backHref =
    month !== null && month.length > 0
      ? `/calendar?month=${month}`
      : "/calendar";

  return (
    <div className="flex flex-col gap-4">
      <BackLink href={backHref}>← カレンダーへ戻る</BackLink>
      <PageHeading>予定を編集</PageHeading>
    </div>
  );
}
