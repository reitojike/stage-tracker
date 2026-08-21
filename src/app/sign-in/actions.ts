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
  const outcome = await requestMagicLink(supabase, email);

  if (outcome === 'unavailable') {
    // Only reached when no verdict about the address was obtained at all,
    // so this cannot be used to distinguish a known from an unknown
    // address.
    redirect('/sign-in?error=unavailable');
  }

  // Deliberately the same outcome whether or not an account exists.
  // Branching on account existence here would let an unauthenticated
  // visitor enumerate which addresses have accounts - which matters
  // because every authenticated user can read the whole shared event
  // catalog.
  redirect('/sign-in?sent=1');
}
