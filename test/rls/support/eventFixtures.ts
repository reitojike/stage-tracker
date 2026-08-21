import type { TestActor } from './testActors.ts';
import { readLocalSupabaseStatus } from './localSupabase.ts';

// Direct authenticated INSERT into events is unsupported (Issue #17): the
// only supported create path is the create_event_with_occurrence RPC. This
// is the shared fixture helper for tests that need an existing event (with
// its required initial occurrence) and don't care about the create path
// itself.

export interface EventFixtureOverrides {
  title?: string;
  startsAt?: string;
  endsAt?: string;
  venue?: string;
  sourceUrl?: string;
  memo?: string;
}

export function eventFixtureTitle(): string {
  return `rls test event ${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
}

export async function createEventWithOccurrence(
  actor: TestActor,
  overrides: EventFixtureOverrides = {},
) {
  const { data: event, error } = await actor.client.rpc('create_event_with_occurrence', {
    p_title: overrides.title ?? eventFixtureTitle(),
    p_starts_at: overrides.startsAt ?? new Date().toISOString(),
    p_venue: overrides.venue,
    p_ends_at: overrides.endsAt,
    p_source_url: overrides.sourceUrl,
    p_memo: overrides.memo,
  });
  if (error) {
    throw new Error(`fixture create_event_with_occurrence failed: ${error.message}`);
  }

  const { data: occurrences, error: occurrencesError } = await actor.client
    .from('event_occurrences')
    .select()
    .eq('event_id', event.id);
  if (occurrencesError) {
    throw new Error(
      `fixture event ${event.id} failed to fetch its occurrence: ${occurrencesError.message}`,
    );
  }
  if (occurrences.length !== 1) {
    throw new Error(
      `fixture event ${event.id} expected exactly one occurrence, found ${String(occurrences.length)}`,
    );
  }
  const [occurrence] = occurrences;
  if (!occurrence) {
    throw new Error(`fixture event ${event.id} occurrence row was missing after the count check`);
  }

  return { event, occurrence };
}

/**
 * Calls create_event_with_occurrence over raw HTTP with an arbitrary JSON
 * body, bypassing the generated Functions Args type entirely. Used only for
 * negative tests that need to send a request shape the typed
 * `actor.client.rpc(...)` call structurally cannot express (e.g. omitting
 * the required p_starts_at) - proving server-side enforcement rather than
 * client-side type-system enforcement.
 */
export async function callCreateEventRpcRaw(
  actor: TestActor,
  body: Record<string, unknown>,
): Promise<Response> {
  const { data, error } = await actor.client.auth.getSession();
  if (error) {
    throw new Error(`failed to read session for raw RPC call: ${error.message}`);
  }
  if (!data.session) {
    throw new Error('actor has no active session for raw RPC call');
  }

  const status = readLocalSupabaseStatus();
  return fetch(`${status.apiUrl}/rest/v1/rpc/create_event_with_occurrence`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: status.anonKey,
      Authorization: `Bearer ${data.session.access_token}`,
    },
    body: JSON.stringify(body),
  });
}
