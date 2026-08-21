import { getAuthenticatedUser } from '@/infrastructure/supabase/session.ts';
import { Button } from '@/ui/Button';
import { HomePage } from '@/ui/HomePage';
import { signOut } from './sign-out/actions.ts';

export default async function Home() {
  const user = await getAuthenticatedUser();

  // The signed-in identity and sign-out control are auth concerns, so they
  // live here rather than inside the shared HomePage component (#10 owns
  // src/ui/). Presentation still comes from the shared primitives.
  return (
    <>
      {user === null ? null : <p>サインイン中: {user.email}</p>}
      <HomePage />
      <form action={signOut}>
        <Button type="submit" variant="secondary">
          サインアウト
        </Button>
      </form>
    </>
  );
}
