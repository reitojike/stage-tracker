import { getAuthenticatedUser } from '@/infrastructure/supabase/session.ts';
import { PageHeading } from '@/ui/PageHeading';
import { AccountSection } from './_components/AccountSection.tsx';
import { PasskeySection } from './_components/PasskeySection.tsx';

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
 */
export default async function MyPage() {
  const user = await getAuthenticatedUser();

  return (
    <>
      <PageHeading>マイページ</PageHeading>
      <AccountSection email={user?.email ?? null} />
      {/* Passkey登録済みuserだけが自分のPasskeyを登録できる（Issue #106） -
          未サインインでは表示自体をしない。 */}
      {user === null ? null : <PasskeySection />}
    </>
  );
}
