import type { User } from '@supabase/supabase-js';
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
