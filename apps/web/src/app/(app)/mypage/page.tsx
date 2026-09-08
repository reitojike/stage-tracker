import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  countMyPendingInvitations,
  getMyPageAccount,
  resolveCanCreateEvent,
} from "./_data/identity";
import { AccountSection } from "./_components/AccountSection";
import { PasskeySection } from "./_components/PasskeySection";
import { ScheduleAndEventSection } from "./_components/ScheduleAndEventSection";

/**
 * マイページ（`docs/v2/oracle-routes-ui.md` §1/§2 `/mypage`）。
 * 到達可能性は既存の default-deny 境界（`proxy.ts`）で保証されるため、
 * ここで追加の認証チェックは行わない。
 */
export default async function MyPage() {
  const supabase = await createSupabaseServerClient();
  const account = await getMyPageAccount();
  const [canCreateEvent, pendingInvitationCount] = await Promise.all([
    resolveCanCreateEvent(supabase, account?.userId ?? null),
    countMyPendingInvitations(supabase, account?.userId ?? null),
  ]);

  return (
    <>
      <h1 className="text-heading leading-heading font-semibold text-foreground">
        マイページ
      </h1>
      <ScheduleAndEventSection
        canCreateEvent={canCreateEvent}
        pendingInvitationCount={pendingInvitationCount}
      />
      <AccountSection email={account?.email ?? null} />
      {account !== null ? <PasskeySection /> : null}
    </>
  );
}
