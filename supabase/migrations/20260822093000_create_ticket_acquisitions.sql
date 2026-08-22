-- Ticket acquisition (Issue #32): one user's attempt to obtain tickets for
-- one occurrence.
--
-- Product semantics (see .ai-dev-foundation/product-rules.md, "Ticket
-- acquisition / Ticket", and Issue #32):
-- - An acquisition is user-owned and occurrence-linked. Unlike events /
--   event_occurrences it is a *personal* concept, not part of the shared
--   catalog: only its owner can read it.
-- - The same user may make several acquisition attempts for the same
--   occurrence, so there is deliberately no unique constraint on
--   (owner_id, occurrence_id).
-- - MVP lifecycle status is exactly pending / secured / unsuccessful. An
--   immediate purchase is created directly as 'secured' rather than being
--   forced through 'pending'. cancelled / withdrawn / refunded are
--   deliberately not added ahead of a concrete need.
-- - memo is the acquisition-level personal note.
-- - An acquisition is not a participation: nothing here reads or writes
--   participation state, and acquisition status never implies attendance.
-- - Deletion is out of scope for this slice: no deleted_at, no DELETE
--   policy - the same boundary events / event_occurrences already draw.

create table public.ticket_acquisitions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id),
  occurrence_id uuid not null references public.event_occurrences (id),
  status text not null default 'pending'
    check (status in ('pending', 'secured', 'unsuccessful')),
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ticket_acquisitions_owner_id_idx on public.ticket_acquisitions (owner_id);
create index ticket_acquisitions_occurrence_id_idx
  on public.ticket_acquisitions (occurrence_id);

-- Mirrors public.set_events_updated_at(): search_path is pinned empty
-- (Postgres function_search_path_mutable hardening) since the function body
-- only touches NEW/now(), which are resolved without any schema lookup.
create function public.set_ticket_acquisitions_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger ticket_acquisitions_set_updated_at
  before update on public.ticket_acquisitions
  for each row
  execute function public.set_ticket_acquisitions_updated_at();

alter table public.ticket_acquisitions enable row level security;

-- Grants are additive to RLS, not a substitute for it - see the comment in
-- 20260820000000_create_events.sql for why authenticated needs explicit
-- grants at all, and why service_role needs its own table-level grant
-- despite BYPASSRLS. anon intentionally receives no grant.
--
-- Column-level grants are the system-managed-field boundary: id,
-- created_at and updated_at are never grantable. owner_id is grantable on
-- INSERT only (ticket_acquisitions_insert_own's WITH CHECK constrains it to
-- the caller) and withheld on UPDATE, so an acquisition cannot be handed to
-- another user. occurrence_id is likewise INSERT-only, so an acquisition
-- cannot be re-pointed at a different occurrence after the fact - the same
-- boundary event_occurrences draws for event_id.
-- The blanket revoke first makes the column-level boundary below exact
-- rather than merely additive. This is load-bearing today, not a guard
-- against some future default-privilege change: on this stack a new public
-- table is created with anon=Dxtm/authenticated=Dxtm, so without this line
-- both roles would keep TRUNCATE - which bypasses RLS entirely - along with
-- REFERENCES/TRIGGER/MAINTAIN. What survives this migration is only what is
-- granted explicitly underneath it. Matches the convention established by
-- 20260822010000_create_occurrence_participations.sql. anon is named here
-- so it is visibly closed, not closed by omission.
revoke all on public.ticket_acquisitions from public, anon, authenticated;

grant select, insert, update, delete on public.ticket_acquisitions to service_role;

grant select on public.ticket_acquisitions to authenticated;
grant insert (owner_id, occurrence_id, status, memo)
  on public.ticket_acquisitions to authenticated;
grant update (status, memo) on public.ticket_acquisitions to authenticated;

create policy ticket_acquisitions_select_own
  on public.ticket_acquisitions
  for select
  to authenticated
  using (owner_id = auth.uid());

create policy ticket_acquisitions_insert_own
  on public.ticket_acquisitions
  for insert
  to authenticated
  with check (owner_id = auth.uid());

-- owner_id has no UPDATE column grant (see above), so USING is what gates
-- non-owner updates; WITH CHECK is symmetric defense-in-depth in case that
-- grant is ever loosened.
create policy ticket_acquisitions_update_own
  on public.ticket_acquisitions
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
