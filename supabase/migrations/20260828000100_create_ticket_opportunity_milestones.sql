-- TicketOpportunity milestones (Issue #162, PO decision #157).
--
-- Product semantics (see .ai-dev-foundation/product-rules.md and #157):
-- - A milestone is "something happening at some point/window in the life of
--   one Opportunity" - application open, application close/deadline, result
--   announcement, sale start, or a payment/settlement window.
-- - Absence of a row is the only representation of "not (yet) known" or "not
--   applicable/held this round" - a conditional phase that may not run, or a
--   result whose date has not been published, is simply not inserted. No
--   fake value (e.g. 00:00 for a date-only source, or a fabricated result
--   date) is ever synthesized to fill a gap.
-- - Real sources mix three distinct precisions for the same kind of fact:
--   a bare date ("2026-09-01"), an exact instant ("2026-09-01 10:00"), and a
--   window ("8/10 18:00〜8/13 23:59"). temporal_precision is an explicit
--   discriminator over three mutually-exclusive column groups so each is
--   stored exactly as given, never coerced into a shape the source did not
--   provide:
--     - 'date'     -> date_value (date)      - a bare calendar date
--     - 'datetime' -> at (timestamptz)       - a single exact instant
--     - 'window'   -> starts_at, ends_at (both timestamptz) - an exact
--                     open/close instant pair
--   A date-only window is not represented, since no reviewed source
--   exhibited one (#157 comment 5442197833); if one is found later, add a
--   4th precision rather than force it through 'window' with an invented
--   time.
-- - unique(opportunity_id, milestone_type): each Opportunity carries at most
--   one instance of a given milestone kind. If a source ever needs several
--   distinct instances of the same kind for one Opportunity (not observed in
--   the reviewed sources), that is a new product question, not something to
--   pre-empt here.

create table public.ticket_opportunity_milestones (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.ticket_opportunities (id) on delete cascade,
  milestone_type text not null
    check (milestone_type in (
      'application_open',
      'application_close',
      'result_announcement',
      'sale_start',
      'payment_window'
    )),
  temporal_precision text not null
    check (temporal_precision in ('date', 'datetime', 'window')),
  date_value date,
  at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (opportunity_id, milestone_type),
  -- Exactly the column group matching temporal_precision is populated;
  -- every other temporal column stays null. This is the enforcement that
  -- makes "no fake conversion" a database invariant rather than an
  -- application-layer convention only.
  check (
    (temporal_precision = 'date'
      and date_value is not null and at is null and starts_at is null and ends_at is null)
    or (temporal_precision = 'datetime'
      and at is not null and date_value is null and starts_at is null and ends_at is null)
    or (temporal_precision = 'window'
      and starts_at is not null and ends_at is not null
      and date_value is null and at is null)
  ),
  check (temporal_precision <> 'window' or ends_at >= starts_at)
);

create index ticket_opportunity_milestones_opportunity_id_idx
  on public.ticket_opportunity_milestones (opportunity_id);

-- Mirrors public.set_events_updated_at(): search_path is pinned empty
-- (Postgres function_search_path_mutable hardening) since the function body
-- only touches NEW/now(), which are resolved without any schema lookup.
create function public.set_ticket_opportunity_milestones_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger ticket_opportunity_milestones_set_updated_at
  before update on public.ticket_opportunity_milestones
  for each row
  execute function public.set_ticket_opportunity_milestones_updated_at();

alter table public.ticket_opportunity_milestones enable row level security;

-- See 20260828000000_create_ticket_opportunities.sql for why the blanket
-- revoke is required before granting anything back on this stack.
revoke all on public.ticket_opportunity_milestones from public, anon, authenticated;

grant select, insert, update, delete on public.ticket_opportunity_milestones to service_role;

-- Shared, read-only for ordinary authenticated users - same authority
-- boundary as ticket_opportunities itself (#157 "Shared / personal
-- authority"). The only write path is the service_role-only import RPC
-- (20260828000300_create_import_ticket_opportunity_rpc.sql).
grant select on public.ticket_opportunity_milestones to authenticated;

create policy ticket_opportunity_milestones_select_authenticated
  on public.ticket_opportunity_milestones
  for select
  to authenticated
  using (true);
