import {
  isAuthApiError,
  isAuthSessionMissingError,
  type SupabaseClient,
} from '@supabase/supabase-js';
import type { Database } from './database.types.ts';
import {
  mapPasskeyListItem,
  type PasskeyListItem,
  type PasskeyManagementError,
  type PasskeyManagementResult,
} from '../../domain/passkey.ts';

// Passkey credential management (Issue #106): list/delete for the currently
// signed-in user's own passkeys via Supabase Auth's `auth.passkey.*` API.
// Deliberately not the `auth.admin.passkey.*` API - that requires the
// service_role key, which product-rules.md's "service role / provider
// credentialsをclientへ露出しない" keeps out of any surface this app's
// authenticated users reach. `auth.passkey.*` instead scopes to whichever
// user the caller's own session belongs to, the same boundary every other
// write in this app relies on.
//
// registerPasskey()/signInWithPasskey() are not wrapped here: both run the
// actual WebAuthn ceremony (navigator.credentials.create()/get()), which
// only exists in a browser. Those are called directly from client
// components against the browser client (see
// src/infrastructure/supabase/browserClient.ts).

export type PasskeyManagementClient = SupabaseClient<Database>;

/**
 * Classifies list()/delete()'s error into this boundary's
 * PasskeyManagementErrorKind vocabulary. Mirrors
 * src/infrastructure/supabase/planningAuth.ts's classifyGetUserError: real
 * AuthError subclasses (isAuthSessionMissingError/isAuthApiError) are the
 * classification surface, not hand-matched status/code literals - GoTrue's
 * own client-side "no session" check throws an AuthSessionMissingError
 * with status 400 and no `code` at all, which a 401-or-known-code check
 * would silently miss and fall through to a generic `failure`.
 */
export function classifyManagementError(error: unknown): PasskeyManagementError {
  if (
    isAuthSessionMissingError(error) ||
    (isAuthApiError(error) && [401, 403].includes(error.status))
  ) {
    return { kind: 'not-authenticated', message: error.message };
  }
  if (error instanceof Error) {
    return { kind: 'failure', message: error.message };
  }
  return { kind: 'failure', message: 'unknown passkey management error' };
}

export async function listPasskeys(
  client: PasskeyManagementClient,
): Promise<PasskeyManagementResult<PasskeyListItem[]>> {
  const { data, error } = await client.auth.passkey.list();
  if (error !== null) {
    return { ok: false, error: classifyManagementError(error) };
  }
  return { ok: true, data: data.map(mapPasskeyListItem) };
}

export async function deletePasskey(
  client: PasskeyManagementClient,
  passkeyId: string,
): Promise<PasskeyManagementResult<null>> {
  const { error } = await client.auth.passkey.delete({ passkeyId });
  if (error !== null) {
    return { ok: false, error: classifyManagementError(error) };
  }
  return { ok: true, data: null };
}
