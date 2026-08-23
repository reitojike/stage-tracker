import { Button } from '@/ui/Button';
import { Surface } from '@/ui/Surface';
import { signOut } from '../../sign-out/actions.ts';
import styles from './HomeAccount.module.css';

export interface HomeAccountProps {
  /** null when the identity could not be read; the panel then shows only
   * the sign-out control rather than claiming an account. */
  email: string | null;
}

/**
 * Signed-in identity plus sign-out, grouped as one account block at the
 * end of Home. Keeping them together stops the sign-out control from
 * reading as a third navigation choice among the destinations above it.
 */
export function HomeAccount({ email }: HomeAccountProps) {
  return (
    <Surface variant="subtle" className={styles.panel}>
      {email === null ? null : <p className={styles.identity}>サインイン中: {email}</p>}
      <form action={signOut}>
        <Button type="submit" variant="secondary">
          サインアウト
        </Button>
      </form>
    </Surface>
  );
}
