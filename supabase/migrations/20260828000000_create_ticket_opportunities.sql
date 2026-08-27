-- TicketOpportunity — shared official planning data (Issue #162, PO decision
-- #157).
--
-- Product semantics (see .ai-dev-foundation/product-rules.md and #157):
-- - A TicketOpportunity is one sales/lottery opportunity against an Event
--   (e.g. 宝塚友の会 第1抽選, Vpass先行, 一般発売). It always belongs to
--   exactly one Event; one Event may have several Opportunities.
-- - display_name preserves the source's own label verbatim - it is never
--   normalized into a closed enum, since real sources use ad-hoc,
--   organization-specific names (FC先行, プレリク, 出演者先行, ...).
-- - source_key is this row's own provenance identity, independent of
--   events.source_key/source_url: one source page can list several distinct
--   opportunities (e.g. 宝塚友の会 schedule PDF listing 第1〜第3抽選 for the
--   same 興行), so identity cannot be derived from the URL alone. Every
--   Opportunity is created by the operator-assisted import path (see
--   20260828000300_create_import_ticket_opportunity_rpc.sql) and nothing
--   else, so - unlike events.source_key (which stays nullable because a
--   manual create path exists alongside import) - this column is required.
-- - target_scope names, without ambiguity, whether the Opportunity concerns
--   the whole Event or a specific subset of its Occurrences. 'event_wide' is
--   a semantic fact about the Opportunity itself, not a snapshot of
--   whichever Occurrences happen to exist at write time - so no relation
--   rows are permitted for it; see ticket_opportunity_target_occurrences
--   below for the 'selected_occurrences' relation and its enforcement.
-- - Deletion/update-by-non-operator is out of scope for this slice: no
--   authenticated INSERT/UPDATE/DELETE grant at all (see the grants below) -
--   the only write path is the service_role-only import RPC. This mirrors
--   how events itself has no authenticated INSERT grant
--   (20260821000200_create_event_with_occurrence_rpc.sql), just drawn one
--   step further since Opportunity has no owner-gated UI write path either.

create table public.ticket_opportunities (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id),
  target_scope text not null
    check (target_scope in ('event_wide', 'selected_occurrences')),
  display_name text not null,
  source_key text not null,
  source_url text,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ticket_opportunities_event_id_idx on public.ticket_opportunities (event_id);
create unique index ticket_opportunities_source_key_key on public.ticket_opportunities (source_key);

-- Mirrors public.set_events_updated_at(): search_path is pinned empty
-- (Postgres function_search_path_mutable hardening) since the function body
-- only touches NEW/now(), which are resolved without any schema lookup.
create function public.set_ticket_opportunities_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger ticket_opportunities_set_updated_at
  before update on public.ticket_opportunities
  for each row
  execute function public.set_ticket_opportunities_updated_at();

alter table public.ticket_opportunities enable row level security;

-- See the "Public schema client grants" comment in
-- 20260822093000_create_ticket_acquisitions.sql for why the blanket revoke
-- is required before granting anything back: this Postgres stack's default
-- privileges hand every new public table anon/authenticated =
-- TRUNCATE+REFERENCES+TRIGGER+MAINTAIN otherwise.
revoke all on public.ticket_opportunities from public, anon, authenticated;

grant select, insert, update, delete on public.ticket_opportunities to service_role;

-- authenticated gets SELECT only - shared catalog data every authenticated
-- user may read - and no INSERT/UPDATE/DELETE grant at all. Ordinary users
-- do not mutate the official schedule in this MVP (product-rules.md
-- "Ticket Opportunity" / #157 "Shared / personal authority"); the only
-- write path is service_role via import_ticket_opportunity (see
-- 20260828000300_create_import_ticket_opportunity_rpc.sql).
grant select on public.ticket_opportunities to authenticated;

create policy ticket_opportunities_select_authenticated
  on public.ticket_opportunities
  for select
  to authenticated
  using (true);

-- Opportunity target occurrences (Issue #162) — the explicit
-- Opportunity <-> Occurrence relation used only when target_scope =
-- 'selected_occurrences'. For an 'event_wide' Opportunity this table holds
-- no rows at all (enforced by the trigger below), so "the whole Event" is
-- never represented as a snapshot of whichever Occurrences exist right now.
create table public.ticket_opportunity_target_occurrences (
  opportunity_id uuid not null references public.ticket_opportunities (id) on delete cascade,
  occurrence_id uuid not null references public.event_occurrences (id),
  created_at timestamptz not null default now(),
  primary key (opportunity_id, occurrence_id)
);

create index ticket_opportunity_target_occurrences_occurrence_id_idx
  on public.ticket_opportunity_target_occurrences (occurrence_id);

-- Enforces two invariants no FK alone can express:
-- 1. the target occurrence must belong to the same Event as the
--    Opportunity (#162 "selected targetのOccurrenceは必ずそのOpportunityの
--    Eventに属していること");
-- 2. a row may only exist while the parent Opportunity's target_scope is
--    'selected_occurrences' - closing the "event-wide snapshot" anti-pattern
--    at the database level, not just by import-path convention.
-- SECURITY DEFINER: this table is only ever written by service_role (see the
-- grants below), which already bypasses RLS, so there is no privilege this
-- function borrows that its caller does not already have; it exists to read
-- the parent Opportunity/Occurrence rows deterministically regardless of the
-- (irrelevant here) caller-scoped RLS on those tables. search_path is
-- pinned empty per this migration file's other functions.
create function public.check_ticket_opportunity_target_occurrence() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_scope text;
  v_opportunity_event_id uuid;
  v_occurrence_event_id uuid;
begin
  select o.target_scope, o.event_id into v_target_scope, v_opportunity_event_id
  from public.ticket_opportunities o
  where o.id = new.opportunity_id;

  if v_target_scope is null then
    raise exception 'ticket opportunity % does not exist', new.opportunity_id;
  end if;

  if v_target_scope <> 'selected_occurrences' then
    raise exception
      'a target occurrence can only be added to a selected_occurrences opportunity'
      using errcode = '23514';
  end if;

  select eo.event_id into v_occurrence_event_id
  from public.event_occurrences eo
  where eo.id = new.occurrence_id;

  if v_occurrence_event_id is null or v_occurrence_event_id <> v_opportunity_event_id then
    raise exception
      'target occurrence must belong to the same event as the opportunity'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger ticket_opportunity_target_occurrences_check
  before insert on public.ticket_opportunity_target_occurrences
  for each row
  execute function public.check_ticket_opportunity_target_occurrence();

alter table public.ticket_opportunity_target_occurrences enable row level security;

revoke all on public.ticket_opportunity_target_occurrences from public, anon, authenticated;

grant select, insert, update, delete on public.ticket_opportunity_target_occurrences to service_role;

grant select on public.ticket_opportunity_target_occurrences to authenticated;

create policy ticket_opportunity_target_occurrences_select_authenticated
  on public.ticket_opportunity_target_occurrences
  for select
  to authenticated
  using (true);
