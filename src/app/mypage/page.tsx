import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient.ts';
import { getAuthenticatedUser } from '@/infrastructure/supabase/session.ts';
import { PageHeading } from '@/ui/PageHeading';
import { catalogNewEventHref } from '@/domain/catalogNavigation.ts';
import { AccountSection } from './_components/AccountSection.tsx';
import { PasskeySection } from './_components/PasskeySection.tsx';
import { ScheduleAndEventSection } from './_components/ScheduleAndEventSection.tsx';
import { resolveCanCreateEvent } from './_lib/creatorCapability.ts';
import { currentTokyoDate } from './_lib/today.ts';

/**
 * My Page (Issue #159): the account/settings surface reached from the
 * AppBar avatar, not a PrimaryNav item. Moves Home's former account block
 * (signed-in email, sign-out, Passkey enrollment/management) here verbatim
 * in behavior - only the presentation changed, from Home's card-style
 * `Surface variant="subtle"` panels to the design handoff's bold-rule
 * section headings (design_handoff_stage_tracker/12-mypage-notifications.md
 * via Issue #148's body: "セクションは 太罫見出し + 本文。カード面は使わ
 * ない").
 *
 * Reachability is enforced by the existing default-deny boundary
 * (src/proxy.ts) - no extra auth check needed here, same as every other
 * primary destination.
 *
 * Issue #193 adds the "予定とイベント" section above Account: the low-
 * frequency management destinations Event Catalog / My Calendar's own
 * ActionRow currently carry. canCreateEvent is resolved server-side via
 * ./_lib/creatorCapability.ts (the same fail-closed designated-creator
 * check catalog/page.tsx's own create affordance already performs) so an
 * unauthorized user never sees the "イベントを追加" row rendered at all.
 */
export default async function MyPage() {
  const client = await createSupabaseServerClient();
  const [user, canCreateEvent] = await Promise.all([
    getAuthenticatedUser(),
    resolveCanCreateEvent(client),
  ]);
  const newEventHref = catalogNewEventHref({
    yearMonth: currentTokyoDate().slice(0, 7),
    selectedDate: null,
  });

  return (
    <>
      <PageHeading>マイページ</PageHeading>
      <ScheduleAndEventSection canCreateEvent={canCreateEvent} newEventHref={newEventHref} />
      <AccountSection email={user?.email ?? null} />
      {/* Passkey登録済みuserだけが自分のPasskeyを登録できる（Issue #106） -
          未サインインでは表示自体をしない。 */}
      {user === null ? null : <PasskeySection />}
    </>
  );
}
