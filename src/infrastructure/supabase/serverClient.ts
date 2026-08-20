import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { Database } from './database.types.ts';
import { readPublicSupabaseEnv } from './env.ts';

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
