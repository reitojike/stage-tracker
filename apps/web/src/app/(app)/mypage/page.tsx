import { PageHeading } from "@stage-tracker/ui";
import { isDesignatedCatalogCreator } from "@/lib/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { countMyPendingInvitations, getMyPageAccount } from "./_data/identity";
import { AccountSection } from "./_components/AccountSection";
import { PasskeySection } from "./_components/PasskeySection";
import { ScheduleAndEventSection } from "./_components/ScheduleAndEventSection";

/**
 * マイページ（`specs/009-authentication-account-access/spec.md` `/mypage`）。
 * 到達可能性は既存の default-deny 境界（`proxy.ts`）で保証されるため、
 * ここで追加の認証チェックは行わない。
 */
export default async function MyPage() {
  const supabase = await createSupabaseServerClient();
  const account = await getMyPageAccount();
  const [canCreateEvent, pendingInvitationCount] =
    account === null
      ? [false, 0]
      : await Promise.all([
          isDesignatedCatalogCreator(supabase, account.userId),
          countMyPendingInvitations(supabase, account.userId),
        ]);

  return (
    <>
      <PageHeading>マイページ</PageHeading>
      <ScheduleAndEventSection
        canCreateEvent={canCreateEvent}
        pendingInvitationCount={pendingInvitationCount}
      />
      <AccountSection email={account?.email ?? null} />
      {account !== null ? <PasskeySection /> : null}
    </>
  );
}
