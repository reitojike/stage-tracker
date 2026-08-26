import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';
import { readPublicSupabaseEnv } from './env.ts';

export function createSupabaseBrowserClient(): SupabaseClient<Database> {
  const { url, anonKey } = readPublicSupabaseEnv();
  // experimental.passkey opts into auth.registerPasskey()/signInWithPasskey()
  // (Issue #106). The WebAuthn ceremony itself (navigator.credentials
  // create()/get()) only exists in a browser, so this flag is set here, not
  // on the server clients that back Server Components/Actions.
  return createBrowserClient<Database>(url, anonKey, {
    auth: { experimental: { passkey: true } },
  });
}
