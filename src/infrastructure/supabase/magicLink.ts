/**
 * The slice of the Supabase client this module needs. Narrow on purpose:
 * `SupabaseClient` satisfies it structurally, and a test can supply a
 * recording stub without a type assertion (which the quality profile
 * forbids).
 */
export interface MagicLinkAuthClient {
  auth: {
    signInWithOtp(credentials: {
      email: string;
      options?: { shouldCreateUser?: boolean };
    }): Promise<{ error: unknown }>;
  };
}

/**
 * Where failures go instead of into the response. Injected so the sign-in
 * path stays testable without depending on a logging backend - production
 * logging infrastructure is deliberately not decided here.
 */
export interface MagicLinkDiagnostics {
  requestFailed(email: string, error: unknown): void;
}

/**
 * Requests a magic-link sign-in email.
 *
 * Returns nothing, deliberately. Earlier revisions returned a classified
 * outcome so the caller could tell the user why a request failed, and
 * every classification attempt turned into an account-existence oracle:
 * the redirect target, then a 4xx/5xx split (a dead SMTP server makes an
 * existing address return 500 while an unknown one returns 422), then the
 * presence of `error.status` (`AuthUnknownError` carries none even though
 * an HTTP response did arrive). Handing the caller no outcome at all is
 * what makes the response envelope invariant by construction rather than
 * by careful case analysis.
 *
 * Failures are reported to `diagnostics` - a server-side channel an
 * unauthenticated caller cannot observe.
 *
 * `shouldCreateUser: false` backstops the account-provisioning decision
 * (public signup disabled - see supabase/config.toml) so a misconfigured
 * project cannot turn a sign-in attempt into a silent account creation.
 * That backstop is unobservable end-to-end while the project is
 * configured correctly, so it is asserted directly against the arguments
 * this function sends.
 */
export async function requestMagicLink(
  client: MagicLinkAuthClient,
  email: string,
  diagnostics?: MagicLinkDiagnostics,
): Promise<void> {
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });

  if (error !== null && error !== undefined) {
    diagnostics?.requestFailed(email, error);
  }
}
