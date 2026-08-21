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
): Promise<{ ok: boolean }> {
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });

  return { ok: error === null };
}
