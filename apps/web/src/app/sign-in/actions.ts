"use server";

import { redirect } from "next/navigation";
import {
  requestMagicLink,
  type MagicLinkDiagnostics,
} from "@/lib/auth/magic-link";
import { readPreviewOrigin } from "@/lib/auth/preview-origin";
import { createSupabaseCookielessServerClient } from "@/lib/supabase/server";

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
 */
export async function requestSignInLink(formData: FormData): Promise<void> {
  const emailValue = formData.get("email");
  const email = typeof emailValue === "string" ? emailValue.trim() : "";

  if (email.length === 0) {
    // ローカルな入力エラーであり、アカウントの有無とは無関係。表示しても
    // 何も漏らさない。
    redirect("/sign-in?error=missing_email");
  }

  const supabase = await createSupabaseCookielessServerClient();
  // Preview デプロイでは、そのデプロイ自身へ戻るリンクをメールに埋める。
  // 渡さないと Supabase は project の Site URL（= Production）へ戻すため、
  // Preview でサインインの動作確認ができない（decisions.md F4b）。
  // Production / local では undefined になり、Supabase の既定の挙動のまま。
  const previewOrigin = readPreviewOrigin();
  await requestMagicLink(supabase, email, diagnostics, {
    ...(previewOrigin === undefined ? {} : { emailRedirectTo: previewOrigin }),
  });

  // unconditional: ここに分岐を再導入しないこと。account の有無・送信
  // 成否・provider の障害、いずれも同じ status / target / body / cookie
  // で終わる。
  redirect(ACKNOWLEDGEMENT);
}
