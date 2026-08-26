import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';
import {
  classifyManagementError,
  mapPasskeyListItem,
  type PasskeyListItem,
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
