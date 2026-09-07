import { readLocalSupabaseStatus } from './localSupabase.ts';
import type { TestActor } from './testActors.ts';

// Raw PostgREST access for negative tests only.
//
// The typed supabase-js client is generated from the real schema, so some
// invalid requests are unrepresentable in TypeScript: a participation status
// outside the `considering`/`attending` enum, an RPC call missing a required
// argument, an unknown column. That is useful evidence in itself, but it
// proves the *generated types* reject the request - not the server. These
// helpers go around the typed client so a test can assert the database
// rejects it too.

async function accessTokenFor(actor: TestActor): Promise<string> {
  const { data, error } = await actor.client.auth.getSession();
  if (error) {
    throw new Error(`failed to read session for raw PostgREST call: ${error.message}`);
  }
  if (!data.session) {
    throw new Error('actor has no active session for raw PostgREST call');
  }
  return data.session.access_token;
}

/**
 * Sends a raw request to a PostgREST path (e.g. `rest/v1/occurrence_participations`
 * or `rest/v1/rpc/invite_to_occurrence`) authenticated as the given actor,
 * with an arbitrary JSON body.
 */
export async function postgrestFetchAs(
  actor: TestActor,
  path: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const status = readLocalSupabaseStatus();
  const accessToken = await accessTokenFor(actor);

  return fetch(`${status.apiUrl}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: status.anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
}
