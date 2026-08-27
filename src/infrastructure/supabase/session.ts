import { cache } from 'react';
import type { User } from '@supabase/supabase-js';
import { resolveMyPageInitial } from '../../domain/myPageIdentity.ts';
import { createSupabaseServerClient } from './serverClient.ts';

/**
 * The auth/feature integration boundary: feature data-access code calls
 * this to learn who the current request is authenticated as, without auth
 * code knowing anything about feature-specific queries.
 *
 * Wrapped in React's `cache()` so every Server Component in one request
 * (a segment's `layout.tsx` resolving the AppBar identity below, plus
 * whatever the page underneath separately calls this or
 * requireAuthenticatedUserId for) shares one `auth.getUser()` round trip
 * instead of each caller re-hitting the Auth server independently.
 */
export const getAuthenticatedUser = cache(async (): Promise<User | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    return null;
  }
  return data.user;
});

export interface MyPageAppBarIdentity {
  myPageHref: string | undefined;
  myPageInitial: string | undefined;
}

/**
 * AppBar's My Page avatar wiring (Issue #159), for every segment
 * `layout.tsx` that renders AppShell with `showPrimaryNav` on. Kept out of
 * AppShell itself so that component stays a plain presentational shell with
 * no Supabase/session dependency of its own - see AppShell.tsx's own
 * comment - and reused here instead of each layout repeating the same
 * getAuthenticatedUser() + initial derivation.
 *
 * `myPageHref` is left unset when there is no resolved user, matching
 * AppShell's/AppBar's own documented contract for the no-session case
 * (same inert-tap-target treatment as `/sign-in`) - even though every
 * caller of this function already sits behind proxy.ts's default-deny
 * boundary, that boundary's own auth check is a separate request from this
 * Server Component's, so a transient failure here is a real, distinct case
 * from "no session at all".
 */
export async function resolveMyPageAppBarIdentity(): Promise<MyPageAppBarIdentity> {
  const user = await getAuthenticatedUser();
  return {
    myPageHref: user === null ? undefined : '/mypage',
    myPageInitial: resolveMyPageInitial(user?.email ?? null),
  };
}
