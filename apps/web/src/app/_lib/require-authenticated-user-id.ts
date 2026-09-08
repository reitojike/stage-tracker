import type { SupabaseClient } from "@supabase/supabase-js";
import { err, ok, userIdSchema, type UserId } from "@stage-tracker/domain";
import { readError, type ReadResult } from "@/lib/data";

/**
 * Page-level "二次チェック" (`docs/v2/oracle-routes-ui.md` §0 / §1 `/`):
 * `proxy.ts`'s default-deny middleware is the primary auth boundary, but
 * each page re-confirms the session itself and renders an
 * `unavailable`/`error` panel instead of a redirect when it fails ("失敗時は
 * redirect せず error パネル表示"). This is display-only, same as
 * `authActionClient` (`@/lib/safe-action.ts`) - the real permission boundary
 * is always RLS/RPC, never this check.
 *
 * Returns a `ReadResult` (never throws) so callers compose it with the rest
 * of a screen's independent reads the same way (`@/lib/data`'s `ReadResult`
 * convention - "すべての read が Result を返し、例外で boundary を突き破ら
 * せない").
 */
export async function requireAuthenticatedUserId(
  supabase: SupabaseClient,
): Promise<ReadResult<UserId>> {
  let userResponse: Awaited<ReturnType<SupabaseClient["auth"]["getUser"]>>;
  try {
    userResponse = await supabase.auth.getUser();
  } catch (thrown) {
    return err(
      readError(
        "failure",
        thrown instanceof Error ? thrown.message : String(thrown),
      ),
    );
  }

  if (userResponse.error !== null || userResponse.data.user === null) {
    return err(readError("unauthenticated", "ログインが必要です。"));
  }

  const parsedUserId = userIdSchema.safeParse(userResponse.data.user.id);
  if (!parsedUserId.success) {
    return err(
      readError(
        "failure",
        `Unexpected auth user id shape: ${parsedUserId.error.message}`,
      ),
    );
  }

  return ok(parsedUserId.data);
}
