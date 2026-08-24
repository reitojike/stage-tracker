-- Event range / occurrence containment (Issue #87 product decision, #88
-- implementation).
--
-- product-rules.md "Event 開催期間（Event range）": an occurrence's starts_at,
-- read as its Asia/Tokyo calendar date, must fall within its parent event's
-- [starts_on, ends_on]. This is a cross-table invariant, so it cannot be a
-- plain single-table CHECK; it is expressed as two constraint triggers
-- instead - one per direction a violation can be introduced from:
--
-- - event_occurrences_within_event_range fires on an occurrence
--   insert/update and checks that one row against its (unchanged) parent
--   event's current range.
-- - events_range_contains_occurrences fires on an event range update and
--   checks every occurrence currently under that event (not just ones
--   named in whatever caused the update) against the new range.
--
-- Both are DEFERRABLE INITIALLY IMMEDIATE: a plain single-statement write
-- (the normal owner-edit path, and any direct client write) is checked at
-- the end of its own statement, same as an ordinary CHECK would be. Naming
-- them separately (rather than one shared constraint) lets a caller defer
-- only the one it actually needs to reorder around - see
-- 20260825000400_create_reschedule_event_rpc.sql, which defers both
-- because it may update either table first.
create function public.check_occurrence_within_event_range() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_starts_on date;
  v_ends_on date;
  v_occurrence_date date;
begin
  select starts_on, ends_on into v_starts_on, v_ends_on
  from public.events
  where id = new.event_id;

  if v_starts_on is null then
    raise exception 'event % referenced by occurrence % does not exist', new.event_id, new.id
      using errcode = '23503';
  end if;

  v_occurrence_date := (new.starts_at at time zone 'Asia/Tokyo')::date;
  if v_occurrence_date < v_starts_on or v_occurrence_date > v_ends_on then
    raise exception
      'occurrence starts_at % (Asia/Tokyo date %) is outside its event''s range [%, %]',
      new.starts_at, v_occurrence_date, v_starts_on, v_ends_on
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create constraint trigger event_occurrences_within_event_range
  after insert or update of starts_at, event_id on public.event_occurrences
  deferrable initially immediate
  for each row
  execute function public.check_occurrence_within_event_range();

create function public.check_event_range_contains_occurrences() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_out_of_range integer;
begin
  select count(*) into v_out_of_range
  from public.event_occurrences oc
  where oc.event_id = new.id
    and (
      (oc.starts_at at time zone 'Asia/Tokyo')::date < new.starts_on
      or (oc.starts_at at time zone 'Asia/Tokyo')::date > new.ends_on
    );

  if v_out_of_range > 0 then
    raise exception
      'event % new range [%, %] no longer contains % existing occurrence(s)',
      new.id, new.starts_on, new.ends_on, v_out_of_range
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create constraint trigger events_range_contains_occurrences
  after update of starts_on, ends_on on public.events
  deferrable initially immediate
  for each row
  execute function public.check_event_range_contains_occurrences();
