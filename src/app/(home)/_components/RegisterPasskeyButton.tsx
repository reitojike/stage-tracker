'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { createSupabaseBrowserClient } from '@/infrastructure/supabase/browserClient.ts';
import {
  classifyCeremonyError,
  resolveCeremonyFeedback,
  type PasskeyCeremonyFeedback,
} from '@/domain/passkey.ts';

/**
 * Enrollment entry point for an already-authenticated user (Issue #106).
 * Client-only by necessity: registerPasskey() runs the actual WebAuthn
 * ceremony (navigator.credentials.create()), which only exists in a
 * browser and requires an active session - both satisfied here, since this
 * button only ever renders inside the authenticated branch of Home (see
 * PasskeySection).
 *
 * router.refresh() re-runs the Server Component that lists registered
 * passkeys (PasskeySection), so a newly registered credential appears
 * without a full navigation.
 */
export function RegisterPasskeyButton() {
  const router = useRouter();
  const [feedback, setFeedback] = useState<PasskeyCeremonyFeedback | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleClick() {
    setFeedback(null);
    setIsPending(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.registerPasskey();
    setIsPending(false);

    if (error !== null) {
      setFeedback(resolveCeremonyFeedback('register', classifyCeremonyError(error)));
      return;
    }

    router.refresh();
  }

  return (
    <div>
      {feedback ? (
        <StatePanel
          variant={feedback.variant}
          title={feedback.title}
          description={feedback.description}
        />
      ) : null}
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          void handleClick();
        }}
        disabled={isPending}
      >
        {isPending ? '登録中…' : 'Passkeyを登録'}
      </Button>
    </div>
  );
}
