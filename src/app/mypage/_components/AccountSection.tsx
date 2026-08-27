import { Button } from '@/ui/Button';
import { signOut } from '../../sign-out/actions.ts';
import styles from './AccountSection.module.css';

export interface AccountSectionProps {
  /** null when the identity could not be read; the section then shows only
   * the sign-out control rather than claiming an account. */
  email: string | null;
}

/**
 * Signed-in identity plus sign-out (Issue #159: moved off Home, formerly
 * HomeAccount). Behavior is unchanged from Home's original block - only
 * the presentation differs, per the design handoff's "太罫見出し + 本文、
 * カード面は使わない" section boundary (see AccountSection.module.css).
 */
export function AccountSection({ email }: AccountSectionProps) {
  return (
    <section className={styles.section} aria-labelledby="mypage-account-heading">
      <h2 id="mypage-account-heading" className={styles.heading}>
        アカウント
      </h2>
      {email === null ? null : <p className={styles.identity}>サインイン中: {email}</p>}
      <form action={signOut}>
        <Button type="submit" variant="secondary">
          サインアウト
        </Button>
      </form>
    </section>
  );
}
