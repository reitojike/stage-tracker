import { NextResponse, type NextRequest } from 'next/server';
import { safeRedirectPath } from '@/domain/redirectSafety.ts';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient.ts';

// The only OTP type this product issues. `type` arrives from the query
// string and GoTrue's EmailOtpType accepts any string, so accepting it
// unchecked would let this route also consume recovery / invite /
// email_change tokens - completing, say, an email change as a side effect
// of what looks like an ordinary sign-in. Sign-in consumes magic links
// only; other flows need their own route and their own UI.
const SUPPORTED_OTP_TYPE = 'email';

// This response carries freshly issued session cookies, so it must never
// be cached: a CDN or reverse proxy that stored it could replay one
// user's session to another. Production hosting is deferred scope, so
// these headers are set here rather than left for whoever configures it.
// The Location stays relative on purpose: `NextResponse.redirect` needs an
// absolute URL, which would have to be built from the request's Host
// header and would make the redirect target depend on it.
function redirectWithoutCaching(target: string): NextResponse {
  return new NextResponse(null, {
    status: 307,
    headers: {
      Location: target,
      'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
      Expires: '0',
      Pragma: 'no-cache',
    },
  });
}

// Consumes the token_hash/type link built by
// supabase/templates/magic_link.html (see supabase/config.toml
// [auth.email.template.magic_link]), rather than the default Supabase
// email template that links straight to the Auth server's own verify
// endpoint and bypasses this app entirely.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const next = safeRedirectPath(searchParams.get('next'));

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

  return redirectWithoutCaching('/sign-in?error=link_expired');
}
