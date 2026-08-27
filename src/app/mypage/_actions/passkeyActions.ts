'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient.ts';
import { deletePasskey } from '@/infrastructure/supabase/passkey.ts';
import {
  INITIAL_PASSKEY_DELETE_FORM_STATE,
  rejectedPasskeyDeleteFormState,
  resolveManagementFeedback,
  type PasskeyDeleteFormState,
} from '@/domain/passkey.ts';

// Revoke a registered passkey (Issue #106, moved from Home to My Page by
// Issue #159). No WebAuthn ceremony is involved - auth.passkey.delete() is
// a plain authenticated request scoped to the caller's own session, same
// boundary as list() (see src/infrastructure/supabase/passkey.ts) - so this
// can be a normal Server Action like every other write in this app, unlike
// registration/sign-in.

export async function deletePasskeyAction(
  previous: PasskeyDeleteFormState,
  formData: FormData,
): Promise<PasskeyDeleteFormState> {
  const passkeyId = formData.get('passkeyId');
  if (typeof passkeyId !== 'string' || passkeyId.length === 0) {
    return rejectedPasskeyDeleteFormState(previous, resolveManagementFeedback('delete', 'failure'));
  }

  const client = await createSupabaseServerClient();
  const result = await deletePasskey(client, passkeyId);
  if (!result.ok) {
    return rejectedPasskeyDeleteFormState(
      previous,
      resolveManagementFeedback('delete', result.error.kind),
    );
  }

  revalidatePath('/mypage');
  return { ...INITIAL_PASSKEY_DELETE_FORM_STATE, attempt: previous.attempt + 1 };
}
