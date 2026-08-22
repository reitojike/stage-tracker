import { isAuthApiError, isAuthSessionMissingError } from '@supabase/supabase-js';
import type { PlanningError, PlanningResult } from '../../domain/planningError.ts';

/**
 * The slice of the Supabase client this module needs. Narrow on purpose:
 * `SupabaseClient<Database>` satisfies it structurally, and a test can
 * supply a stub without a type assertion (which the quality profile
 * forbids) - the same convention as magicLink.ts's MagicLinkAuthClient.
 */
export interface AuthenticatedIdentityClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
}

/**
 * Classifies `client.auth.getUser()`'s error into this boundary's
 * PlanningErrorKind vocabulary. Exported and pure (no network call) so its
 * branches can be pinned directly against real AuthError subclasses in a
 * unit test, independent of requireAuthenticatedUserId's own network call.
 *
 * The error covers two different failure classes that must not be
 * collapsed together: no/invalid session (AuthSessionMissingError, or an
 * AuthApiError with a 401/403 status) is genuinely `unauthenticated` - but
 * the same call can also fail with an AuthApiError 5xx, an
 * AuthRetryableFetchError (network failure, rate limit), or an
 * AuthUnknownError, none of which say anything about whether the caller is
 * signed in. Reporting those as `unauthenticated` too would send a
 * signed-in caller through a sign-in flow during a transient Auth-service
 * outage, instead of the retryable `failure` the situation actually is.
 */
export function classifyGetUserError(error: unknown): PlanningError {
  if (
    isAuthSessionMissingError(error) ||
    (isAuthApiError(error) && [401, 403].includes(error.status))
  ) {
    return {
      kind: 'unauthenticated',
      message: error.message,
      code: error.name,
    };
  }
  if (error instanceof Error) {
    return { kind: 'failure', message: error.message, code: error.name };
  }
  return { kind: 'failure', message: 'unknown auth error', code: 'unknown-auth-error' };
}

/**
 * Resolves the caller's own id from the given client's session (Issue #33).
 *
 * Several tables this boundary writes to (occurrence_participations,
 * personal_schedule_entries, ticket_acquisitions, tickets) grant the
 * relevant owner/user id column on INSERT, relying on RLS's WITH CHECK to
 * reject a spoofed value rather than withholding the column entirely (unlike
 * events.owner_id, which the create RPC derives server-side - see
 * domain/eventCatalogWrite.ts). Those inserts still need *a* value to send.
 *
 * This resolves that value from the client's own session rather than
 * trusting an id the caller passed in some other way, so a missing/expired
 * session is reported as `unauthenticated` by this typed boundary itself -
 * rather than surfacing later as an opaque 42501 from the database once an
 * insert is attempted with an id that no longer matches any live session.
 * RLS still re-validates the id independently on every write; this is not a
 * substitute for that.
 */
export async function requireAuthenticatedUserId(
  client: AuthenticatedIdentityClient,
): Promise<PlanningResult<string>> {
  const { data, error } = await client.auth.getUser();
  if (error !== null) {
    return { ok: false, error: classifyGetUserError(error) };
  }
  if (data.user === null) {
    return {
      ok: false,
      error: {
        kind: 'unauthenticated',
        message: 'no authenticated user for this client',
        code: 'no-user',
      },
    };
  }
  return { ok: true, data: data.user.id };
}
