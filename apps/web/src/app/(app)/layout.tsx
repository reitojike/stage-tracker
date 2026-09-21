import type { ReactNode } from "react";
import { AppShell } from "@stage-tracker/ui";
import { hasUnreadNotifications } from "@/lib/data/reads/notifications";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveMyPageAppBarIdentity } from "./_lib/app-bar-identity";

/**
 * Shared `layout.tsx` for authenticated screens under the `(app)` route group.
 * `the current route implementation and its tests`
 * §0 describes each route segment's `layout.tsx` as an identical, minimal
 * Server Component that resolves the AppBar identity and renders
 * `AppShell` - the legacy app duplicated this file once per route folder
 * (a consequence of not having used a route group there). This Task uses a
 * single Next.js route group (`(app)`) instead so the 4 pages below share
 * this one file rather than 4 copies of the same 6 lines; the group does
 * not change any URL (`(app)/page.tsx` is still served at `/`), and
 * `/sign-in`/`/sign-out`/`/auth/confirm` stay outside this group entirely so
 * they keep using only the bare root `layout.tsx` (no AppShell chrome, no
 * PrimaryNav) - matching the authentication contract's "未認証面で nav を隠す" requirement
 * without needing a `showPrimaryNav={false}` prop threaded through those
 * pages.
 */
export default async function AppShellLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const { myPageHref, myPageInitial } =
    await resolveMyPageAppBarIdentity(supabase);
  const unreadResult = await hasUnreadNotifications(supabase);
  // A failed unread read is only a presentation fallback: it must not turn
  // into a cached or persisted "zero unread" product fact. The inbox remains
  // the screen-level authority for explaining and retrying read failures.
  const hasUnread = unreadResult.ok ? unreadResult.value : false;

  return (
    <AppShell
      myPageHref={myPageHref}
      myPageInitial={myPageInitial}
      notificationsHref="/notifications"
      hasUnreadNotifications={hasUnread}
    >
      {children}
    </AppShell>
  );
}
