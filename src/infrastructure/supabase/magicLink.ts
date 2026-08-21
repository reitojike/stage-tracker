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
 * `delivered` covers both "sent" and "no such account": the caller must
 * present them identically, or an unauthenticated visitor could enumerate
 * which addresses have accounts - which matters because every
 * authenticated user can read the whole shared event catalog.
 *
 * `unavailable` means no verdict was reached (auth service unreachable,
 * or a server-side fault). That reveals nothing about any account, so it
 * is safe - and necessary - to surface rather than claim a link was sent.
 */
export type MagicLinkOutcome = 'delivered' | 'unavailable';

function isAccountLevelRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  if (!('status' in error)) {
    return false;
  }
  // A 4xx from the Auth API is a verdict about this request (an address
  // with no account yields status 422 / `otp_disabled`). Status 0 from a
  // failed fetch, or a 5xx, means the request never got a verdict.
  const { status } = error;
  return typeof status === 'number' && status >= 400 && status < 500;
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
  return isAccountLevelRejection(error) ? 'delivered' : 'unavailable';
}
