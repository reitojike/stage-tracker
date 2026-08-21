import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { Database } from './database.types.ts';
import { readPublicSupabaseEnv } from './env.ts';

/**
 * A client that reads cookies but never writes any back to the response.
 *
 * The sign-in request needs this: supabase-js stores a PKCE code verifier
 * when an address exists and *clears* those cookies when it does not, so
 * a response that carries its cookie writes tells an unauthenticated
 * caller whether the account exists - an enumeration oracle that no
 * amount of matching the status and Location would hide.
 *
 * Nothing is lost by discarding them. This product completes sign-in with
 * `verifyOtp({ token_hash })` from its own email template, which does not
 * use the code verifier.
 */
export async function createSupabaseCookielessServerClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();
  const { url, anonKey } = readPublicSupabaseEnv();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // Intentionally dropped - see above.
      },
    },
  });
}

/**
 * For use in Server Components, Route Handlers, and Server Actions. In a
 * Server Component render, cookies() is read-only, so a refreshed session
 * cannot be written back here - middleware.ts owns that refresh instead.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();
  const { url, anonKey } = readPublicSupabaseEnv();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render, where the cookie store
          // is read-only. Safe to ignore: middleware.ts refreshes the
          // session on every request.
        }
      },
    },
  });
}
