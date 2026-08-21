'use server';

import { redirect } from 'next/navigation';
import { requestMagicLink } from '@/infrastructure/supabase/magicLink.ts';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient.ts';

export async function requestSignInLink(formData: FormData): Promise<void> {
  const emailValue = formData.get('email');
  const email = typeof emailValue === 'string' ? emailValue.trim() : '';

  if (email.length === 0) {
    // About the submitted input, not about whether an account exists, so
    // this does not leak account existence.
    redirect('/sign-in?error=missing_email');
  }

  const supabase = await createSupabaseServerClient();
  await requestMagicLink(supabase, email);

  // Deliberately the same outcome whether or not an account exists.
  // Branching here (sent vs error) would let an unauthenticated visitor
  // enumerate which addresses have accounts - which matters because every
  // authenticated user can read the whole shared event catalog.
  redirect('/sign-in?sent=1');
}
