import { BackLink, PageHeading } from "@stage-tracker/ui";
import { resolveScreenNow } from "@/app/_lib/now";
import { tokyoYearMonthOf } from "@/app/_lib/calendar-grid";
import { catalogMonthHref } from "../_lib/catalog-links";

/** `docs/v2/oracle-routes-ui.md` §1: `/catalog/invitations` の loading は
 * Server Component で十分。 */
export default function InvitationsLoading() {
  const backHref = catalogMonthHref(
    tokyoYearMonthOf(resolveScreenNow().todayTokyoDate),
  );

  return (
    <>
      <BackLink href={backHref}>イベントへ戻る</BackLink>
      <PageHeading>招待一覧</PageHeading>
      <p role="status" className="text-body-sm text-muted-foreground">
        読み込み中…
      </p>
    </>
  );
}
