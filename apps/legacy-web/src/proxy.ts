import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { readPublicSupabaseEnv } from '@/infrastructure/supabase/env.ts';

// Routes reachable without an authenticated session. Everything else is
// authenticated-only by default so a newly added route can't silently
// bypass the boundary by omission.
const PUBLIC_PATHS = new Set(['/sign-in', '/auth/confirm']);

// Exact match only. Treating descendants as public too (`/sign-in/...`)
// would silently expose any nested route added under one of these
// prefixes later, without that route ever being added to the allowlist.
function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

function copyCookies(from: NextResponse, to: NextResponse): void {
  for (const cookie of from.cookies.getAll()) {
    to.cookies.set(cookie);
  }
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const { url, anonKey } = readPublicSupabaseEnv();

  const supabase = createServerClient(url, anonKey, {
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
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const authenticated = user !== null;
  const { pathname } = request.nextUrl;

  if (!authenticated && !isPublicPath(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/sign-in';
    const redirectResponse = NextResponse.redirect(redirectUrl);
    copyCookies(response, redirectResponse);
    return redirectResponse;
  }

  if (authenticated && pathname === '/sign-in') {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/';
    const redirectResponse = NextResponse.redirect(redirectUrl);
    copyCookies(response, redirectResponse);
    return redirectResponse;
  }

  return response;
}

// Only explicit, non-application paths are excluded. Deliberately no
// file-extension rule: a pattern like `.*\.(svg|png|...)$` would also
// exclude application pathnames that merely end in those characters
// (e.g. `/events/some-future-page.png`), letting them skip the
// authenticated boundary entirely. Unknown application paths must
// default-deny regardless of how they end. If a public asset is ever
// needed, add it here as an explicit exception.
//
// The PWA entries (Issue #304) are that kind of explicit exception. An
// install prompt is evaluated before the user signs in, so the manifest
// and its icons have to be fetchable anonymously; excluding them here
// rather than adding them to PUBLIC_PATHS also keeps a static icon
// request from doing a Supabase session lookup it has no use for.
//
// Each is anchored with `$`, so the exception is exact-path: it covers
// `/pwa/icon-192.png` but not `/pwa/`, `/pwa/anything-else.png`, or
// `/pwa/icon-192.png/sub`, all of which stay default-denied. `public/pwa/`
// is reserved for these assets, so no application route is ever served
// from one of these paths.
//
// Next.js only accepts a statically analyzable matcher, so this list
// cannot be built from PWA_PUBLIC_ASSET_PATHS (src/pwa/appIdentity.ts).
// src/pwa/__tests__/appIdentity.test.ts fails if the two disagree, and
// test/auth/routeProtection.test.ts proves the resulting boundary over
// real HTTP.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico$|manifest\\.webmanifest$|pwa/icon-192\\.png$|pwa/icon-512\\.png$|pwa/maskable-icon-512\\.png$|pwa/apple-touch-icon\\.png$).*)',
  ],
};
