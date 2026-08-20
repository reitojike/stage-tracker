import { getAuthenticatedUser } from '@/infrastructure/supabase/session.ts';
import { HomePage } from '@/ui/HomePage';
import { signOut } from './sign-out/actions.ts';

export default async function Home() {
  const user = await getAuthenticatedUser();

  return (
    <>
      <HomePage email={user?.email ?? null} />
      <form action={signOut}>
        <button type="submit">サインアウト</button>
      </form>
    </>
  );
}
