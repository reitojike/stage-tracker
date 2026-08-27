import type { User } from '@supabase/supabase-js';
import { resolveMyPageInitial } from '../../domain/myPageIdentity.ts';
import { createSupabaseServerClient } from './serverClient.ts';

/**
 * The auth/feature integration boundary: feature data-access code calls
 * this to learn who the current request is authenticated as, without auth
 * code knowing anything about feature-specific queries.
 */
export async function getAuthenticatedUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    return null;
  }
  return data.user;
}

export interface MyPageAppBarIdentity {
  myPageHref: string;
  myPageInitial: string | undefined;
}

/**
 * AppBar's My Page avatar wiring (Issue #159), for every segment
 * `layout.tsx` that renders AppShell with `showPrimaryNav` on. Kept out of
 * AppShell itself so that component stays a plain presentational shell with
 * no Supabase/session dependency of its own - see AppShell.tsx's own
 * comment - and reused here instead of each layout repeating the same
 * getAuthenticatedUser() + initial derivation.
 */
export async function resolveMyPageAppBarIdentity(): Promise<MyPageAppBarIdentity> {
  const user = await getAuthenticatedUser();
  return {
    myPageHref: '/mypage',
    myPageInitial: resolveMyPageInitial(user?.email ?? null),
  };
}
