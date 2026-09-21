import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/data/database.types";

export interface AppBarIdentity {
  readonly myPageHref: string;
  readonly myPageInitial: string;
}

const FALLBACK_INITIAL = "?";

/**
 * `resolveMyPageAppBarIdentity()` (`this route and its tests`): the shared
 * authenticated-screen layout resolves the caller's email initial and
 * `/mypage` href, purely to feed `AppShell`/`AppBar`'s presentational props
 * (`packages/ui/src/app-bar.tsx`). `/mypage` is a real implemented screen;
 * this helper only supplies its navigation identity.
 *
 * This never fails the page: authentication enforcement belongs to the route
 * or data boundary that owns each screen, not to this layout-level chrome
 * helper. If the session can't be read here for any reason, this falls back
 * to a placeholder initial rather than throwing - the layout renders shared
 * chrome only, so a chrome-level identity lookup failure must not prevent the
 * screen's own content or error handling from rendering.
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
