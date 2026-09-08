"use server";

import { redirect } from "next/navigation";
import {
  requestMagicLink,
  type MagicLinkDiagnostics,
} from "@/lib/auth/magic-link";
import { createSupabaseCookielessServerClient } from "@/lib/supabase/server";
import { isPreviewDeployment } from "@/lib/auth/vercel-environment";

/**
 * この action が返す唯一の acknowledgement。`sent=1` ではなく
 * `requested=1` にしているのは、実際にメールが送信されたかをこの
 * action は知り得ないため（`docs/v2/oracle-routes-ui.md` §1 `/sign-in`）。
 */
const ACKNOWLEDGEMENT = "/sign-in?requested=1";

// server 側のみで観測する診断チャンネル。unauthenticated caller には
// 一切見せない（`requestMagicLink` の doc comment 参照）。
const diagnostics: MagicLinkDiagnostics = {
  requestFailed(email, error) {
    console.error("[auth] magic link request failed", { email, error });
  },
};

/**
 * Magic link サインインをリクエストする Server Action。
 *
 * enumeration 対策: アカウントの有無・送信成否のいずれによっても
 * このレスポンスを変えてはならない（`docs/v2/oracle-routes-ui.md` §1
 * `requestSignInLink` の記述）。`requestMagicLink` は分岐材料を一切
 * 返さないため、この関数にも分岐すべき outcome が存在しない——最後は
 * 常に同じ `redirect(ACKNOWLEDGEMENT)` に到達する。
 *
 * cookieless client を使うのは、通常の server client だと PKCE code
 * verifier cookie の有無がアカウント存在の oracle になるため
 * （`src/lib/supabase/server.ts` の `createSupabaseCookielessServerClient`
 * doc comment、`docs/v2/oracle-domain.md` §4.1 参照）。
 *
 * Preview（`isPreviewDeployment`、`src/lib/auth/vercel-environment.ts`）
 * では magic link を送らない（Codex P1、`docs/v2/decisions.md`）。この
 * 判定は environment 由来でアカウント依存ではないため、
 * `requestMagicLink` の呼び出し自体を早期 return で省いても
 * enumeration 対策の不変性は壊れない——preview かどうかは何を送信しても
 * 変わらない定数であり、応答からアカウントの有無を分岐させる新しい経路には
 * ならない。最終的な redirect 先は常に同じ `ACKNOWLEDGEMENT`。
 */
export async function requestSignInLink(formData: FormData): Promise<void> {
  const emailValue = formData.get("email");
  const email = typeof emailValue === "string" ? emailValue.trim() : "";

  if (email.length === 0) {
    // ローカルな入力エラーであり、アカウントの有無とは無関係。表示しても
    // 何も漏らさない。
    redirect("/sign-in?error=missing_email");
  }

  if (!isPreviewDeployment()) {
    const supabase = await createSupabaseCookielessServerClient();
    // emailRedirectTo は渡さない。PO 判断（decisions.md「Preview 環境の位置づけ」）
    // により、Free 運用中は remote Preview Supabase を持たず、Vercel Preview で
    // authenticated flow を提供しない。Supabase の Site URL による既定の挙動へ委ねる。
    await requestMagicLink(supabase, email, diagnostics);
  }

  // unconditional: ここに分岐を再導入しないこと。account の有無・送信
  // 成否・provider の障害・preview 判定、いずれも同じ status / target /
  // body / cookie で終わる。
  redirect(ACKNOWLEDGEMENT);
}
