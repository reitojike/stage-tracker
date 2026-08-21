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
 * `delivered` covers "sent", "no such account", and any other per-request
 * verdict: the caller must present them identically, or an
 * unauthenticated visitor could enumerate which addresses have accounts -
 * which matters because every authenticated user can read the whole
 * shared event catalog.
 *
 * `unavailable` is reserved for failures that are request-independent by
 * construction, so it can never correlate with a particular address.
 */
export type MagicLinkOutcome = 'delivered' | 'unavailable';

/**
 * True only when the Auth API produced no HTTP response at all (a failed
 * fetch, reported by supabase-js as status 0).
 *
 * Classifying by status *class* is not safe here. Measured against a
 * local GoTrue with SMTP pointed at a dead port: an address that exists
 * returns 500 (the mailer fails only after the user is found) while an
 * address that does not exist returns 422 `otp_disabled`. Treating 5xx as
 * "request-independent" would therefore have made the 500 an existence
 * oracle in exactly the situation where it matters. Only "we never got a
 * response" is genuinely independent of which address was submitted.
 */
function reachedTheAuthService(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return false;
  }
  const { status } = error;
  return typeof status === 'number' && status > 0;
}

/**
 * Requests a magic-link sign-in email.
 *
 * `shouldCreateUser: false` backstops the account-provisioning decision
 * (public signup disabled - see supabase/config.toml) so a misconfigured
 * project cannot turn a sign-in attempt into a silent account creation.
 *
 * That backstop is deliberately unobservable end-to-end while the project
 * is configured correctly: GoTrue refuses the creation anyway, so removing
 * the option changes nothing an integration test could see. It is
 * therefore asserted directly, against the arguments this function sends.
 */
export async function requestMagicLink(
  client: MagicLinkAuthClient,
  email: string,
): Promise<MagicLinkOutcome> {
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });

  if (error === null || error === undefined) {
    return 'delivered';
  }
  // Any HTTP response means the service evaluated this specific address,
  // so it must be presented identically to success. Only "no response at
  // all" is safe to surface.
  return reachedTheAuthService(error) ? 'delivered' : 'unavailable';
}
