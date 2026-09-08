import { NextResponse, type NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/auth/redirect-safety";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// このプロダクトが発行する唯一の OTP type。`type` はクエリ文字列由来で、
// GoTrue の `EmailOtpType` は任意の文字列を受け付けるため、無検証で通すと
// このルートが recovery / invite / email_change の token も消費してしまい
// 得る（一見普通のサインインに見える操作の副作用として email change が
// 完了してしまう等）。サインインは magic link のみを消費する
// （`docs/v2/oracle-routes-ui.md` §1 `/auth/confirm`）。
const SUPPORTED_OTP_TYPE = "email";

// セッション cookie を含むレスポンスなので、CDN・reverse proxy にキャッシュ
// させてはならない（キャッシュされると別ユーザーへ同じセッションを配信し
// 得る）。Location は相対パスのまま保つ：`NextResponse.redirect` は絶対
// URL を要求するが、それを request の Host header から組み立てると
// redirect 先が Host header 依存になってしまう。
function redirectWithoutCaching(target: string): NextResponse {
  return new NextResponse(null, {
    status: 307,
    headers: {
      Location: target,
      "Cache-Control":
        "private, no-cache, no-store, must-revalidate, max-age=0",
      Expires: "0",
      Pragma: "no-cache",
    },
  });
}

/**
 * Magic Link コールバック（`docs/v2/oracle-routes-ui.md` §1
 * `/auth/confirm`）。`token_hash` を `verifyOtp` で検証し、セッションを
 * 確立する。`next` は `safeRedirectPath`（同一オリジンのみ許可）を通す。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeRedirectPath(searchParams.get("next"));

  if (tokenHash !== null && type === SUPPORTED_OTP_TYPE) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: SUPPORTED_OTP_TYPE,
    });
    if (!error) {
      return redirectWithoutCaching(next);
    }
  }

  return redirectWithoutCaching("/sign-in?error=link_expired");
}
