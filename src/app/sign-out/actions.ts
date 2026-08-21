'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient.ts';

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/sign-in');
}
