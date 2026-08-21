import Link from 'next/link';
import { getAuthenticatedUser } from '@/infrastructure/supabase/session.ts';
import { Button } from '@/ui/Button';
import { HomePage } from '@/ui/HomePage';
import { signOut } from './sign-out/actions.ts';

export default async function Home() {
  const user = await getAuthenticatedUser();

  // The signed-in identity, Catalog entry point, and sign-out control are
  // auth/navigation concerns, so they live here rather than inside the
  // shared HomePage component (#10 owns src/ui/). Presentation still comes
  // from the shared primitives; exact bottom-nav IA is intentionally
  // unresolved by docs/ux-ui.md, so this is a minimal entry link, not a
  // full nav shell.
  return (
    <>
      {user === null ? null : <p>サインイン中: {user.email}</p>}
      <HomePage />
      <nav>
        <Link href="/catalog">Event Catalogを見る</Link>
      </nav>
      <form action={signOut}>
        <Button type="submit" variant="secondary">
          サインアウト
        </Button>
      </form>
    </>
  );
}
