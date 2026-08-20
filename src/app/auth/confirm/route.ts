import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { safeRedirectPath } from '@/domain/redirectSafety.ts';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient.ts';

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

  if (tokenHash !== null && type !== null) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) {
      redirect(next);
    }
  }

  redirect('/sign-in?error=link_expired');
}
