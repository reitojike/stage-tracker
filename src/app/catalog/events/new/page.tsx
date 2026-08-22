import Link from 'next/link';
import { StatePanel } from '@/ui/StatePanel';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient';
import { getAuthenticatedUser } from '@/infrastructure/supabase/session';
import { isDesignatedCatalogCreator } from '@/infrastructure/supabase/eventCatalogWrite';
import { resolveWriteFeedback } from '@/domain/eventWriteFeedback';
import { catalogMonthHref, resolveCatalogParams } from '@/domain/catalogNavigation';
import { currentTokyoDate } from '../../_lib/today.ts';
import { EventCreateForm } from '../../_components/EventCreateForm.tsx';

interface NewEventPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Event creation, restricted to designated catalog creators (Issue #29 /
 * product-rules.md "MVP Event catalog write boundary").
 *
 * Being signed in is already guaranteed by the default-deny boundary in
 * src/proxy.ts; this page adds only the creator check on top. That check
 * decides what to *render* - the database is what decides what persists
 * (create_event_with_occurrence raises insufficient_privilege for a
 * non-creator), so reaching this URL directly cannot create anything even
 * if this page were wrong.
 *
 * A membership lookup that fails is deliberately not treated as "not a
 * creator": that would tell an actual creator they lack permission
 * whenever the check itself broke. It renders as a load failure instead
 * (docs/ux-ui.md "Common states").
 */
export default async function NewEventPage({ searchParams }: NewEventPageProps) {
  const rawParams = await searchParams;
  const context = resolveCatalogParams(rawParams, currentTokyoDate());
  const backHref = catalogMonthHref(context.yearMonth);

  const user = await getAuthenticatedUser();
  if (user === null) {
    return (
      <main>
        <Link href={backHref}>← カレンダーに戻る</Link>
        <StatePanel
          variant="error"
          title="サインイン状態を確認できませんでした"
          description="お手数ですが、もう一度サインインしてからお試しください。"
        />
      </main>
    );
  }

  const client = await createSupabaseServerClient();
  const creatorCheck = await isDesignatedCatalogCreator(client, user.id);

  if (!creatorCheck.ok) {
    return (
      <main>
        <Link href={backHref}>← カレンダーに戻る</Link>
        <StatePanel
          variant="error"
          title="権限を確認できませんでした"
          description="通信状況を確認し、もう一度お試しください。"
        />
      </main>
    );
  }

  if (!creatorCheck.data) {
    const denial = resolveWriteFeedback('create-event', 'permission-denied');
    return (
      <main>
        <Link href={backHref}>← カレンダーに戻る</Link>
        <StatePanel
          variant={denial.variant}
          title={denial.title}
          description={denial.description}
        />
      </main>
    );
  }

  return (
    <main>
      <Link href={backHref}>← カレンダーに戻る</Link>
      <h1>イベントを登録</h1>
      <EventCreateForm context={context} />
    </main>
  );
}
