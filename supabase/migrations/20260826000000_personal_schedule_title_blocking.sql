-- Personal Schedule: fixed schedule_type -> free-form title + blocking
-- model, and owner-initiated entry deletion (Issue #121, supersedes the
-- closed schedule_type vocabulary and no-DELETE posture from
-- 20260822000000_create_personal_schedule.sql / Issue #31).
--
-- Product decision (Issue #121):
-- - A schedule entry no longer carries a closed category
--   (paid_leave/work/travel/other). It carries a required free-form
--   `title` and an independent `blocking` boolean ("does this entry
--   occupy availability"). `blocking` travels with the entry to every
--   recipient it is shared with - there is no per-recipient override.
-- - The entry owner may hard-delete an entry. Deletion is not soft/
--   reversible (no deleted_at, no trash/restore) - see product-rules.md
--   "Ticket" for the same "no escape hatch until deletion semantics are
--   decided" reasoning this Task now resolves specifically for personal
--   schedule.
-- - A deleted entry must disappear from every visible surface, owner and
--   recipients alike. personal_schedule_shares is access metadata that is
--   entirely dependent on its parent entry (the only FK referencing
--   personal_schedule_entries - confirmed against this migration's own
--   schema before writing it), so entry deletion cascades to its share
--   rows rather than leaving them as orphans with no entry left to grant
--   access to.
--
-- Existing data: this Task's Task Contract requires evaluating a
-- non-destructive backfill before any destructive alternative. The
-- backfill below is a plain 4-value mapping (paid_leave/work/travel/other
-- -> a fixed Japanese label, mirroring the current UI's own labels) plus
-- `blocking = true` for every existing row (the prior schema had no
-- non-blocking concept at all, so every existing entry was implicitly
-- "blocking" under the old semantics) - not complex or risky enough to
-- justify the destructive fallback the Task Contract allows, so this
-- migration does not use it.
--
-- Wrapped in an explicit transaction with an access-exclusive lock on
-- personal_schedule_entries for the same reason as
-- 20260821000100_backfill_and_drop_event_temporal_columns.sql: without it,
-- a concurrent INSERT using the pre-migration schema_type-only shape could
-- land between the backfill UPDATE and the column drop, leaving a row
-- whose title/blocking were never populated to be silently discarded by
-- DROP COLUMN's dependent-constraint cleanup having nothing left to
-- validate against.
begin;

lock table public.personal_schedule_entries in access exclusive mode;

alter table public.personal_schedule_entries
  add column title text,
  add column blocking boolean;

update public.personal_schedule_entries
set
  title = case schedule_type
    when 'paid_leave' then '有給休暇'
    when 'work' then '仕事'
    when 'travel' then '遠征'
    else 'その他'
  end,
  blocking = true
where title is null;

alter table public.personal_schedule_entries
  alter column title set not null,
  alter column blocking set not null;

-- Drops the now-unused column along with the CHECK constraint that
-- referenced it (personal_schedule_entries_schedule_type_check) and the
-- column-level INSERT/UPDATE grants scoped to it - Postgres does this
-- automatically for a table constraint/grant that references only the
-- dropped column, no CASCADE required (mirrors the identical reasoning in
-- 20260821000100_backfill_and_drop_event_temporal_columns.sql for
-- events.starts_at/ends_at).
alter table public.personal_schedule_entries
  drop column schedule_type;

-- Re-grants column-level INSERT/UPDATE for the two new columns. Additive
-- to the column-level grants the create migration already holds for memo/
-- is_all_day/starts_on/ends_on/starts_at/ends_at (a column grant does not
-- revoke previously granted columns it does not mention), so the net
-- effect is the same total grantable-column set as before, minus
-- schedule_type and plus title/blocking.
grant insert (title, blocking) on public.personal_schedule_entries to authenticated;
grant update (title, blocking) on public.personal_schedule_entries to authenticated;

-- Owner-only hard delete (Issue #121 "Entry deletion semantics"). This is
-- the first DELETE grant/policy this table has ever had - the create
-- migration deliberately withheld both, mirroring events/event_occurrences
-- at the time. authenticated already has table-level DELETE revoked from
-- PUBLIC by default (20260822120000_harden_public_schema_client_grants.sql
-- baseline), so this grant plus the policy below is what makes delete
-- possible at all, scoped to exactly the rows this policy's USING clause
-- matches.
grant delete on public.personal_schedule_entries to authenticated;

create policy personal_schedule_entries_delete_own
  on public.personal_schedule_entries
  for delete
  to authenticated
  using (owner_id = auth.uid());

-- Cascades a share row's deletion to its parent entry's deletion (Issue
-- #121 "dependent sharesは安全にcleanupし、orphanを残さない"). Replaces the
-- create migration's plain (no ON DELETE action, i.e. NO ACTION) FK - which
-- would have made entry deletion fail outright with any remaining share
-- rows, since NO ACTION forbids a delete that would orphan a referencing
-- row rather than propagating it. personal_schedule_shares carries nothing
-- worth keeping once its entry is gone (no independent product meaning
-- outside "this entry is shared with this user" - see the create
-- migration's own header), so cascading is the correct action here, not
-- merely the most convenient one.
alter table public.personal_schedule_shares
  drop constraint personal_schedule_shares_schedule_entry_id_fkey,
  add constraint personal_schedule_shares_schedule_entry_id_fkey
    foreign key (schedule_entry_id)
    references public.personal_schedule_entries (id)
    on delete cascade;

commit;
