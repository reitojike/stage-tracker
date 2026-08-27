-- UserTicketOpportunityState — personal lightweight planning state
-- (Issue #162, PO decision #157).
--
-- Product semantics (see .ai-dev-foundation/product-rules.md and #157):
-- - Exactly two statuses: 'planned' (申し込む予定) and 'applied'
--   (申し込み済み). No row = this Opportunity is not registered as a
--   personal planning target - this is not an application record, so
--   pending/secured/unsuccessful, 当選/落選, 第1〜第N希望, quantity, seat
--   type, or an actual submission payload never belong here (that
--   boundary already exists as ticket_acquisitions/tickets - Issue #32 -
--   and is not repurposed by this Task; see .ai-dev-foundation/
--   product-rules.md "Existing ticket_acquisition / Ticket boundary").
-- - user-owned: only the owner may read or write their own row. Unlike
--   ticket_opportunities/ticket_opportunity_milestones (shared, read-only
--   for authenticated users), this table has no shared read policy at all.
-- - unique(user_id, opportunity_id): a user has at most one state per
--   Opportunity.
-- - Official/shared writes (the import RPC) never touch this table -
--   nothing in 20260828000300_create_import_ticket_opportunity_rpc.sql
--   references it, so an import can never create, change, or remove a
--   user's personal state as a side effect.
-- - Independent of participation (#157 "Participation independence"): no
--   trigger here reads or writes occurrence_participations, and nothing in
--   the participation slice reads or writes this table.

create table public.user_ticket_opportunity_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  opportunity_id uuid not null references public.ticket_opportunities (id) on delete cascade,
  status text not null
    check (status in ('planned', 'applied')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, opportunity_id)
);

create index user_ticket_opportunity_states_user_id_idx
  on public.user_ticket_opportunity_states (user_id);
create index user_ticket_opportunity_states_opportunity_id_idx
  on public.user_ticket_opportunity_states (opportunity_id);

-- Mirrors public.set_events_updated_at(): search_path is pinned empty
-- (Postgres function_search_path_mutable hardening) since the function body
-- only touches NEW/now(), which are resolved without any schema lookup.
create function public.set_user_ticket_opportunity_states_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger user_ticket_opportunity_states_set_updated_at
  before update on public.user_ticket_opportunity_states
  for each row
  execute function public.set_user_ticket_opportunity_states_updated_at();

alter table public.user_ticket_opportunity_states enable row level security;

-- See 20260828000000_create_ticket_opportunities.sql for why the blanket
-- revoke is required before granting anything back on this stack.
revoke all on public.user_ticket_opportunity_states from public, anon, authenticated;

grant select, insert, update, delete on public.user_ticket_opportunity_states to service_role;

-- Column-level grants are the system-managed-field boundary, mirroring
-- ticket_acquisitions (20260822093000_create_ticket_acquisitions.sql):
-- id/created_at/updated_at are never grantable. user_id is INSERT-only
-- (the WITH CHECK below constrains it to the caller) and withheld on
-- UPDATE, so a row can never be handed to another user. opportunity_id is
-- likewise INSERT-only, so a personal state row cannot be re-pointed at a
-- different Opportunity after creation - the same boundary
-- ticket_acquisitions draws for occurrence_id.
grant select on public.user_ticket_opportunity_states to authenticated;
grant insert (user_id, opportunity_id, status)
  on public.user_ticket_opportunity_states to authenticated;
grant update (status) on public.user_ticket_opportunity_states to authenticated;
grant delete on public.user_ticket_opportunity_states to authenticated;

create policy user_ticket_opportunity_states_select_own
  on public.user_ticket_opportunity_states
  for select
  to authenticated
  using (user_id = auth.uid());

create policy user_ticket_opportunity_states_insert_own
  on public.user_ticket_opportunity_states
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- user_id has no UPDATE column grant (see above), so USING is what gates
-- non-owner updates; WITH CHECK is symmetric defense-in-depth in case that
-- grant is ever loosened - mirrors ticket_acquisitions_update_own.
create policy user_ticket_opportunity_states_update_own
  on public.user_ticket_opportunity_states
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy user_ticket_opportunity_states_delete_own
  on public.user_ticket_opportunity_states
  for delete
  to authenticated
  using (user_id = auth.uid());
