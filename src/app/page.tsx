import { getAuthenticatedUser } from '@/infrastructure/supabase/session.ts';
import { AppShell } from '@/ui/AppShell';
import { PageHeading } from '@/ui/PageHeading';
import { HomeAccount } from './_components/HomeAccount.tsx';
import { HomeNav } from './_components/HomeNav.tsx';

/**
 * Home is the entry point for the Gate A journeys: it names the two
 * primary destinations and their difference, keeps Personal Schedule
 * management reachable as a secondary path, and ends with the account
 * block (#70 bounded IA decision).
 *
 * Navigation lives in HomeNav rather than here, and the shell owns layout;
 * this page only resolves the signed-in identity. The exact bottom-nav IA
 * is still intentionally unresolved by docs/ux-ui.md - see PrimaryNav.
 */
export default async function Home() {
  const user = await getAuthenticatedUser();

  return (
    <AppShell>
      <PageHeading>ホーム</PageHeading>
      <HomeNav />
      <HomeAccount email={user?.email ?? null} />
    </AppShell>
  );
}
