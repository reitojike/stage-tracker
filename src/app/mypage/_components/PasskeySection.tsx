import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient.ts';
import { listPasskeys } from '@/infrastructure/supabase/passkey.ts';
import { StatePanel } from '@/ui/StatePanel';
import {
  passkeyDisplayLabel,
  resolveManagementFeedback,
  type PasskeyListItem,
  type PasskeyManagementErrorKind,
} from '@/domain/passkey.ts';
import { DeletePasskeyForm } from './DeletePasskeyForm.tsx';
import { RegisterPasskeyButton } from './RegisterPasskeyButton.tsx';
import styles from './PasskeySection.module.css';

function PasskeyListView({ passkeys }: { passkeys: PasskeyListItem[] }) {
  if (passkeys.length === 0) {
    return <p className={styles.empty}>登録済みのPasskeyはありません。</p>;
  }

  return (
    <ul className={styles.list}>
      {passkeys.map((passkey) => {
        const label = passkeyDisplayLabel(passkey);
        return (
          <li key={passkey.id} className={styles.item}>
            <span className={styles.itemLabel}>{label}</span>
            <DeletePasskeyForm passkeyId={passkey.id} passkeyLabel={label} />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Passkey enrollment entry point + credential management (Issue #106, moved
 * off Home onto My Page by Issue #159 - behavior unchanged, only the
 * presentation moved off Home's `Surface variant="subtle"` panel onto the
 * design handoff's bold-rule heading + body (see PasskeySection.module.css).
 * Only ever rendered for an authenticated user (see mypage/page.tsx) -
 * registerPasskey() requires an active session, and there is nothing to
 * list/revoke without one.
 *
 * Fetches the list server-side (no ceremony involved in list/delete - see
 * src/infrastructure/supabase/passkey.ts) so it reflects the true
 * server-known state on every render, including right after
 * RegisterPasskeyButton's router.refresh().
 */
export async function PasskeySection() {
  const client = await createSupabaseServerClient();
  const result = await listPasskeys(client);

  return (
    <section className={styles.section} aria-labelledby="mypage-passkey-heading">
      <h2 id="mypage-passkey-heading" className={styles.heading}>
        Passkey
      </h2>
      <p className={styles.description}>
        登録した端末では、次回以降メールアドレス入力なしでサインインできます。
      </p>

      <RegisterPasskeyButton />

      {result.ok ? (
        <PasskeyListView passkeys={result.data} />
      ) : (
        <StatePanelForManagementError kind={result.error.kind} />
      )}
    </section>
  );
}

function StatePanelForManagementError({ kind }: { kind: PasskeyManagementErrorKind }) {
  const feedback = resolveManagementFeedback('list', kind);
  return (
    <StatePanel
      variant={feedback.variant}
      title={feedback.title}
      description={feedback.description}
    />
  );
}
