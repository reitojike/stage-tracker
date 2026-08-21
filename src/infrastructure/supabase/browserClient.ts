import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';
import { readPublicSupabaseEnv } from './env.ts';

export function createSupabaseBrowserClient(): SupabaseClient<Database> {
  const { url, anonKey } = readPublicSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey);
}
