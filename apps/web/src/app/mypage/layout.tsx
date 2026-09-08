import { AppShell } from "@stage-tracker/ui";
import { getMyPageAccount, resolveMyPageInitial } from "./_data/identity";

/**
 * `/mypage` の segment layout。`docs/v2/oracle-routes-ui.md` §0 のとおり
 * Server Component で `AppShell` を描画するだけ。認証チェックは
 * `proxy.ts`（Middleware）が一次防御として既に持つため、ここでは行わない。
 */
export default async function MyPageLayout({
  children,
}: LayoutProps<"/mypage">) {
  const account = await getMyPageAccount();

  return (
    <AppShell
      myPageHref="/mypage"
      myPageInitial={resolveMyPageInitial(account?.email ?? null)}
    >
      {children}
    </AppShell>
  );
}
