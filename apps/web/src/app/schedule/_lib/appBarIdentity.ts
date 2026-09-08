import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * `docs/v2/oracle-routes-ui.md` §0 の `resolveMyPageAppBarIdentity()`
 * （「自分の email 頭文字と `/mypage` への href を解決」）に相当する、
 * `/schedule/*` 用の最小実装。
 *
 * apps/web にはまだこのヘルパーの共有版が存在せず（M6 の各 route track が
 * 並行実装中で、まだどこにも一本化されていない）、このタスクは
 * `apps/web/src/app/schedule/` の外を編集できない制約があるため、共有
 * 実装を新設する代わりにこの route 専用の薄い実装をここへ置く。
 * `/calendar`・`/catalog`・`/mypage` 等の並行 Task が同じロジックを
 * 自分の layout.tsx にも個別実装している可能性が高く、将来の統合
 * （`lib/auth/` あたりへ1本化する）はこのタスクの scope 外として報告する
 * （oracle 自身も「各 route は横断共有の『今日』ヘルパーを持たず機能ごとに
 * 個別に持つ」という意図的な重複を認めており、同じ位置づけと捉えている）。
 *
 * 認証は `proxy.ts` の default-deny middleware が既に保証しているため、
 * `user` が null になるのは想定外のケースのみ。その場合でも例外を投げず
 * `null` を返し、呼び出し元（`layout.tsx`）が保守的なフォールバックを
 * 選べるようにする。
 */
export interface ScheduleAppBarIdentity {
  readonly myPageHref: string;
  readonly myPageInitial: string;
}

const MY_PAGE_HREF = "/mypage";
const FALLBACK_INITIAL = "?";

export async function resolveScheduleAppBarIdentity(): Promise<ScheduleAppBarIdentity | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  const email = user.email?.trim() ?? "";
  const initial =
    email.length > 0 ? email.charAt(0).toUpperCase() : FALLBACK_INITIAL;

  return { myPageHref: MY_PAGE_HREF, myPageInitial: initial };
}
