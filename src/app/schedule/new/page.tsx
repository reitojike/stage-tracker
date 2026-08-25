import { ScheduleEntryCreateForm } from '../_components/ScheduleEntryCreateForm.tsx';
import { BackLink } from '@/ui/BackLink';
import { PageHeading } from '@/ui/PageHeading';

/**
 * Personal schedule entry creation (Issue #37). Any authenticated user may
 * create their own entry (personal_schedule_entries_insert_own RLS), so
 * this page needs no permission-membership check the way the Event create
 * page does for designated catalog creators - reachability alone
 * (src/proxy.ts) is enough, and the database is what actually enforces
 * owner_id = auth.uid() regardless.
 */
export default function NewSchedulePage() {
  return (
    <>
      <BackLink href="/schedule">個人の予定に戻る</BackLink>
      <PageHeading>予定を追加</PageHeading>
      <ScheduleEntryCreateForm />
    </>
  );
}
