-- Event range / Event開催期間 (Issue #87 product decision, #88 implementation).
--
-- events gains starts_on/ends_on (Asia/Tokyo calendar date, both inclusive)
-- as a first-class product fact - the officially published 初日〜千秋楽,
-- independent of whatever occurrence rows happen to exist
-- (.ai-dev-foundation/product-rules.md "Event 開催期間（Event range）").
-- This explicitly reverses #13's "公演期間は公演回からのみ導出する" rule,
-- which Issue #17 materialized by dropping events.starts_at/ends_at
-- entirely (20260821000100_backfill_and_drop_event_temporal_columns.sql).
--
-- Every existing event currently satisfies "an event has >= 1 occurrence"
-- (the invariant #88 relaxes), so a mechanical initial value is always
-- computable here. This migration does not assume that in general, though:
-- the fail-closed check below aborts rather than leaving any row with a
-- null starts_on/ends_on if that assumption ever turns out to be wrong for
-- this dataset.
begin;

alter table public.events
  add column starts_on date,
  add column ends_on date;

-- Mechanical initial value only, not the official Event range: current
-- import does not take 貸切 occurrences (deliberately never inserted), so
-- an event with any such performance will backfill to a narrower range
-- than what was actually announced. product-rules.md sanctions this as a
-- starting point that operators correct afterwards by reapplying a seed
-- file whose startsOn/endsOn carries the official range (see
-- docs/runbooks/catalog-import.md) - not by a one-off manual UPDATE.
with occurrence_range as (
  select
    event_id,
    min((starts_at at time zone 'Asia/Tokyo')::date) as starts_on,
    max((starts_at at time zone 'Asia/Tokyo')::date) as ends_on
  from public.event_occurrences
  group by event_id
)
update public.events e
set starts_on = occurrence_range.starts_on,
    ends_on = occurrence_range.ends_on
from occurrence_range
where occurrence_range.event_id = e.id;

do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing
  from public.events
  where starts_on is null or ends_on is null;

  if v_missing > 0 then
    raise exception
      'events range backfill left % row(s) with a null starts_on/ends_on - this migration only derives a range from existing event_occurrences rows, so any event with zero occurrences needs starts_on/ends_on assigned by hand before this migration can proceed',
      v_missing;
  end if;
end;
$$;

alter table public.events
  alter column starts_on set not null,
  alter column ends_on set not null;

alter table public.events
  add constraint events_starts_on_le_ends_on check (starts_on <= ends_on);

commit;

-- Column-level GRANT is additive per privilege type (unlike `revoke all`,
-- which clears everything) - this extends the existing
-- `grant update (title, venue, source_url, memo) ...` from
-- 20260822120000_harden_public_schema_client_grants.sql to also cover the
-- two new columns, without needing to restate the descriptive-field list.
grant update (starts_on, ends_on) on public.events to authenticated;
