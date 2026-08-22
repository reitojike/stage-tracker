import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';
import type { PlanningResult } from '../../domain/planningError.ts';

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
  client: SupabaseClient<Database>,
): Promise<PlanningResult<string>> {
  const { data, error } = await client.auth.getUser();
  if (error !== null) {
    return {
      ok: false,
      error: {
        kind: 'unauthenticated',
        message: 'no authenticated user for this client',
        code: 'unauthenticated',
      },
    };
  }
  return { ok: true, data: data.user.id };
}
