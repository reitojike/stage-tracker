'use server';

import { redirect } from 'next/navigation';
import {
  requestMagicLink,
  type MagicLinkDiagnostics,
} from '@/infrastructure/supabase/magicLink.ts';
import { createSupabaseCookielessServerClient } from '@/infrastructure/supabase/serverClient.ts';

/**
 * The single acknowledgement this action ever produces. It is
 * deliberately not `sent=1`: nothing here knows whether an email was
 * actually sent, and saying so would be a claim the app cannot make.
 */
const ACKNOWLEDGEMENT = '/sign-in?requested=1';

// Server-side only. Sign-in failures (unknown address, SMTP outage,
// provider fault) must never reach the response, so they are reported
// here instead. Choosing production logging infrastructure is out of
// scope for this task; this is the seam it will attach to.
const diagnostics: MagicLinkDiagnostics = {
  requestFailed(email, error) {
    console.error('[auth] magic link request failed', { email, error });
  },
};

export async function requestSignInLink(formData: FormData): Promise<void> {
  const emailValue = formData.get('email');
  const email = typeof emailValue === 'string' ? emailValue.trim() : '';

  if (email.length === 0) {
    // A local input error, independent of whether any account exists, so
    // showing it discloses nothing.
    redirect('/sign-in?error=missing_email');
  }

  // Cookieless on purpose: supabase-js otherwise persists a PKCE verifier
  // for a known address and clears it for an unknown one, which is an
  // enumeration oracle in the Set-Cookie header.
  const supabase = await createSupabaseCookielessServerClient();
  await requestMagicLink(supabase, email, diagnostics);

  // Unconditional. There is no branch here to reintroduce, and
  // requestMagicLink returns nothing to branch on: account existence,
  // send success, SMTP failure and provider errors all end here with the
  // same status, target, body and cookies.
  redirect(ACKNOWLEDGEMENT);
}
