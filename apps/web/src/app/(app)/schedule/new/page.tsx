import { tokyoCalendarDateSchema } from "@stage-tracker/domain";
import { BackLink, PageHeading } from "../_components/PageChrome";
import { CreateScheduleEntryForm } from "../_components/CreateScheduleEntryForm";

type NewSchedulePageProps = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Personal Schedule create route. Lifecycle semantics belong to Spec 007;
 * route and prefill behavior are runtime-owned.
 *
 * 認証は proxy.ts の default-deny が既に保証している（作成自体は誰でも
 * 可 - RLS `personal_schedule_entries_insert_own` が `owner_id` を
 * caller に強制する）ため、このページ自身は追加の権限チェックを行わない。
 */
function resolvePrefillDate(rawDate: string | undefined): string | undefined {
  if (rawDate === undefined) {
    return undefined;
  }
  // 不正/欠如時は prefill なし（runtime contract）- エラー表示は
  // 出さず、静かに無視する。
  return tokyoCalendarDateSchema.safeParse(rawDate).success
    ? rawDate
    : undefined;
}

export default async function NewSchedulePage({
  searchParams,
}: NewSchedulePageProps) {
  const params = await searchParams;
  const rawDate = typeof params.date === "string" ? params.date : undefined;
  const prefillDate = resolvePrefillDate(rawDate);
  const backHref = prefillDate ? `/calendar?date=${prefillDate}` : "/calendar";

  return (
    <div className="flex flex-col gap-4">
      <BackLink href={backHref}>カレンダーへ戻る</BackLink>
      <PageHeading>予定を追加</PageHeading>
      <CreateScheduleEntryForm prefillDate={prefillDate} />
    </div>
  );
}
