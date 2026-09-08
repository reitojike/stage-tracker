import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/env";
import { isPublicPath } from "@/lib/auth/public-paths";

function copyCookies(from: NextResponse, to: NextResponse): void {
  for (const cookie of from.cookies.getAll()) {
    to.cookies.set(cookie);
  }
}

/**
 * default-deny な認証境界（`docs/v2/oracle-routes-ui.md` §0/§4.3）。
 *
 * `isPublicPath`（`src/lib/auth/public-paths.ts`）の完全一致以外の
 * 全パスは、未認証アクセスを `/sign-in` へ redirect する。認証済みで
 * `/sign-in` に来た場合は `/` へ redirect する。
 *
 * 「元の行き先」は保持しない（`next` パラメータは付与しない）。これは
 * 現行と同じ挙動であり、`/auth/confirm` の `next` パラメータ（同一
 * オリジンのみ許可、`src/lib/auth/redirect-safety.ts`）とは別の
 * mechanism ——後者はメール内リンクの query string に由来する。
 *
 * この層自身が `createServerClient`（`@supabase/ssr`）を生成し、cookie の
 * 読み書き（トークン refresh）をレスポンスへ反映する。Server Component
 * 内の `createSupabaseServerClient`（`src/lib/supabase/server.ts`）が
 * cookie 書き込みに失敗しても安全なのは、この層が毎リクエストで refresh
 * を担保しているため。
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const authenticated = user !== null;
  const { pathname } = request.nextUrl;

  if (!authenticated && !isPublicPath(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/sign-in";
    redirectUrl.search = "";
    const redirectResponse = NextResponse.redirect(redirectUrl);
    copyCookies(response, redirectResponse);
    return redirectResponse;
  }

  if (authenticated && pathname === "/sign-in") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    redirectUrl.search = "";
    const redirectResponse = NextResponse.redirect(redirectUrl);
    copyCookies(response, redirectResponse);
    return redirectResponse;
  }

  return response;
}

// 明示的な非 application path のみを除外する。ファイル拡張子ベースの
// 一般ルールは意図的に採用しない: `.*\.(png|svg|...)$` のようなパターンは
// `.png` 等で終わる application pathname（例: `/events/future-page.png`）
// も除外してしまい、default-deny 境界を素通りさせ得る。未知の application
// path は末尾に関わらず default-deny のままにする。
//
// PWA の manifest / icon（`docs/v2/oracle-routes-ui.md` §0、legacy の
// `PWA_PUBLIC_ASSET_PATHS`）は同種の明示例外だが、apps/web にはまだ
// それらの route/asset 自体が存在しないため、ここには追加しない。
// 追加する場合は exact-path のみを対象にし（`$` で終端し、descendant を
// 含めない）、対応する asset 一覧との同期を検証するテストを併設すること。
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico$).*)"],
};
