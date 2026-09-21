import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/data/database.types";

export interface AppBarIdentity {
  readonly myPageHref: string;
  readonly myPageInitial: string;
}

const FALLBACK_INITIAL = "?";

/**
 * `resolveMyPageAppBarIdentity()`: each authenticated route's `layout.tsx`
 * resolves the caller's email initial and
 * `/mypage` href, purely to feed `AppShell`/`AppBar`'s presentational props
 * (`packages/ui/src/app-bar.tsx`). The shared layout owns this chrome-level
 * identity lookup; the href and initial are passed through without making
 * them part of page-level data loading.
 *
 * This never fails the page: the real auth gate is each page's own
 * `requireAuthenticatedUserId` (`@/app/_lib/require-authenticated-user-id`),
 * not this layout-level chrome helper. If the session can't be read here for
 * any reason, this falls back to a placeholder initial rather than
 * throwing - a chrome-level identity lookup failing must not prevent the
 * page's own content (including that page's own auth-failure panel) from
 * rendering.
 */
export async function resolveMyPageAppBarIdentity(
  supabase: SupabaseClient<Database>,
): Promise<AppBarIdentity> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const email = user?.email;
    const initial =
      email !== undefined && email.length > 0
        ? email.charAt(0).toUpperCase()
        : FALLBACK_INITIAL;
    return { myPageHref: "/mypage", myPageInitial: initial };
  } catch {
    return { myPageHref: "/mypage", myPageInitial: FALLBACK_INITIAL };
  }
}
