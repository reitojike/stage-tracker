import { AppShell } from "@stage-tracker/ui";
import { resolveScheduleAppBarIdentity } from "./_lib/appBarIdentity";

/**
 * `/schedule/*` の共通シェル（`docs/v2/oracle-routes-ui.md` §0:
 * 「各 route segment の layout.tsx は例外なく Server Component で…
 * `<AppShell>` を描画するだけ」）。`loading.tsx` もこの shell の内側に
 * 描画されるため、pending 中も app bar / bottom nav が残り続ける。
 *
 * `/schedule` は PrimaryNav の4項目（ホーム/イベント/チケット/カレンダー）
 * に含まれない（decisions.md P2 で PO 確定済み: 個人予定管理は
 * カレンダーからの入口を維持する）が、AppShell 自体は
 * `showPrimaryNav` を明示的に false にしない限り常にこの4項目 nav を
 * 描画する - `/schedule/*` はこの nav の非対象という意味ではなく、
 * 単に「4項目のどれも現在地としてハイライトされない」だけであり、
 * 他の認証済み画面と同じ shell を維持する。
 */
export default async function ScheduleLayout({
  children,
}: LayoutProps<"/schedule">) {
  const identity = await resolveScheduleAppBarIdentity();

  return (
    <AppShell
      myPageHref={identity?.myPageHref ?? "/mypage"}
      myPageInitial={identity?.myPageInitial ?? "?"}
    >
      {children}
    </AppShell>
  );
}
