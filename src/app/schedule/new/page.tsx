import { ScheduleEntryCreateForm } from '../_components/ScheduleEntryCreateForm.tsx';
import { BackLink } from '@/ui/BackLink';
import { PageHeading } from '@/ui/PageHeading';
import { resolveScheduleCreatePrefill } from '@/domain/personalScheduleWrite.ts';
import { scheduleNewBackHref } from '@/domain/myCalendarNavigation.ts';

interface NewSchedulePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Personal schedule entry creation (Issue #37). Any authenticated user may
 * create their own entry (personal_schedule_entries_insert_own RLS), so
 * this page needs no permission-membership check the way the Event create
 * page does for designated catalog creators - reachability alone
 * (src/proxy.ts) is enough, and the database is what actually enforces
 * owner_id = auth.uid() regardless.
 *
 * Issue #196: also reads an optional `date` query param, My Calendar's
 * selected-day add action's own bounded prefill contract (see
 * personalScheduleWrite.ts's resolveScheduleCreatePrefill) - a missing/
 * malformed value resolves to no prefill, identical to reaching this page
 * any other way.
 */
export default async function NewSchedulePage({ searchParams }: NewSchedulePageProps) {
  const rawParams = await searchParams;
  const initialValues = resolveScheduleCreatePrefill(rawParams);
  const backHref = scheduleNewBackHref(rawParams.date);
  return (
    <>
      <BackLink href={backHref}>マイカレンダーに戻る</BackLink>
      <PageHeading>予定を追加</PageHeading>
      <ScheduleEntryCreateForm initialValues={initialValues} />
    </>
  );
}
