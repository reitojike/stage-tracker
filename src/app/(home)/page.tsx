import { PageHeading } from '@/ui/PageHeading';
import { HomeNav } from './_components/HomeNav.tsx';

/**
 * Home is the entry point for the Gate A journeys: it names the two
 * primary destinations and their difference, and keeps Personal Schedule
 * management reachable as a secondary path. The account block (signed-in
 * email, sign-out, Passkey management) moved off Home onto My Page, reached
 * from the AppBar avatar instead (Issue #159) - Home no longer resolves the
 * signed-in identity itself. The shell around it comes from this segment's
 * own layout.tsx, the same way every other destination gets it.
 *
 * Navigation lives in HomeNav rather than here, and the shell owns layout;
 * this page only names the destinations. The exact bottom-nav IA is still
 * intentionally unresolved by docs/ux-ui.md - see PrimaryNav.
 */
export default function Home() {
  return (
    <>
      <PageHeading>ホーム</PageHeading>
      <HomeNav />
    </>
  );
}
