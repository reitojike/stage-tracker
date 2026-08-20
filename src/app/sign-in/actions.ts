'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient.ts';

export async function requestSignInLink(formData: FormData): Promise<void> {
  const emailValue = formData.get('email');
  const email = typeof emailValue === 'string' ? emailValue.trim() : '';

  if (email.length === 0) {
    redirect('/sign-in?error=send_failed');
  }

  const supabase = await createSupabaseServerClient();
  // shouldCreateUser: false backstops the account-provisioning decision
  // (public signup disabled - see supabase/config.toml) even if that
  // project-level setting is ever misconfigured.
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });

  if (error) {
    // Deliberately generic: distinguishing "unknown email" from other
    // failures here would let a caller enumerate which email addresses
    // have accounts.
    redirect('/sign-in?error=send_failed');
  }

  redirect('/sign-in?sent=1');
}
