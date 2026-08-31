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
import styles from './PasskeySignInButton.module.css';

/**
 * Daily primary sign-in path for a user who has already registered a
 * Passkey (Issue #106). Discoverable credentials mean the browser resolves
 * the account on its own, so this button asks for no email up front - the
 * Magic Link form below it stays the fallback for everyone else.
 *
 * Client-only by necessity: signInWithPasskey() runs the actual WebAuthn
 * ceremony (navigator.credentials.get()), which only exists in a browser.
 * A successful ceremony writes the session to cookies via the browser
 * client's own storage (see createSupabaseBrowserClient); router.refresh()
 * is what makes the next Server Component render see it.
 *
 * Always lands on '/' on success, matching the Magic Link email template's
 * own hardcoded next=/ (supabase/templates/magic_link.html) - neither path
 * currently supports returning to an arbitrary page.
 */
export function PasskeySignInButton() {
  const router = useRouter();
  const [feedback, setFeedback] = useState<PasskeyCeremonyFeedback | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleClick() {
    setFeedback(null);
    setIsPending(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPasskey();
    setIsPending(false);

    if (error !== null) {
      setFeedback(resolveCeremonyFeedback('sign-in', classifyCeremonyError(error)));
      return;
    }

    router.push('/');
    router.refresh();
  }

  return (
    <div className={styles.block}>
      {feedback ? (
        <StatePanel
          variant={feedback.variant}
          title={feedback.title}
          description={feedback.description}
        />
      ) : null}
      <Button
        className={styles.button}
        type="button"
        onClick={() => {
          void handleClick();
        }}
        disabled={isPending}
      >
        {isPending ? 'サインイン中…' : 'Passkeyでサインイン'}
      </Button>
      <p className={styles.helper}>登録済みの端末ならこれだけで入れます。</p>
    </div>
  );
}
