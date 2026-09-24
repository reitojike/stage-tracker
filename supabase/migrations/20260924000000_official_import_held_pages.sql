-- Issue #634: record bounded, non-raw identities for unparsed detail pages.
-- Migration ordering: additive. Existing four-argument commit RPCs remain
-- available to already-deployed workers and sources with no held pages.

create table public.official_import_held_pages (
  run_id uuid not null references public.official_import_runs (id),
  source_id text not null
    check (char_length(btrim(source_id)) between 1 and 128),
  canonical_url text not null
    check (
      char_length(btrim(canonical_url)) between 1 and 2048
      and canonical_url ~ '^https?://'
    ),
  official_external_id text not null
    check (char_length(btrim(official_external_id)) between 1 and 512),
  title text not null check (char_length(btrim(title)) between 1 and 512),
  starts_on date not null,
  ends_on date not null,
  reason_code text not null check (reason_code = 'source_parse'),
  reported_at timestamptz not null default now(),
  primary key (run_id, canonical_url),
  check (starts_on <= ends_on)
);

create index official_import_held_pages_source_run_idx
  on public.official_import_held_pages (source_id, run_id);
create index official_import_held_pages_recent_idx
  on public.official_import_held_pages (reported_at desc, run_id);

alter table public.official_import_held_pages enable row level security;
revoke all on public.official_import_held_pages from public, anon, authenticated;
grant select, insert, update, delete on public.official_import_held_pages to service_role;
grant select on public.official_import_held_pages to authenticated;

create policy official_import_held_pages_select_catalog_creators
  on public.official_import_held_pages
  for select
  to authenticated
  using (
    exists (
      select 1 from public.catalog_creators cc
      where cc.user_id = auth.uid()
    )
  );

create function public.commit_owned_official_import_partial_batch(
  p_run_id uuid,
  p_source_id text,
  p_attempt_token text,
  p_candidates jsonb,
  p_held_pages jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run public.official_import_runs;
begin
  if p_held_pages is null or jsonb_typeof(p_held_pages) <> 'array' then
    raise exception 'official import held pages must be a JSON array'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_held_pages) not between 1 and 30
    or pg_catalog.pg_column_size(p_held_pages) > 32768 then
    raise exception 'official import held page report exceeds its bounds'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_held_pages) as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or not (item.value ?& array[
        'canonical_url', 'official_external_id', 'title',
        'starts_on', 'ends_on', 'reason_code'
      ])
  ) then
    raise exception 'official import held page report has an invalid shape'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_held_pages) as held(canonical_url text)
    group by held.canonical_url
    having count(*) > 1
  ) then
    raise exception 'official import held page report contains duplicates'
      using errcode = '22023';
  end if;

  select run.* into v_run
  from public.official_import_runs as run
  where run.id = p_run_id
  for update;
  if not found or v_run.source_id is distinct from p_source_id then
    raise exception 'official import run is missing or source does not match'
      using errcode = '22023';
  end if;
  if v_run.status = 'completed' then
    return public.commit_owned_official_import_candidate_batch(
      p_run_id, p_source_id, p_attempt_token, p_candidates
    );
  end if;
  if v_run.status <> 'running'
    or v_run.active_attempt_token is distinct from p_attempt_token
    or v_run.active_attempt_lease_expires_at <= clock_timestamp() then
    raise exception 'official import attempt no longer owns the run'
      using errcode = '55000';
  end if;

  insert into public.official_import_held_pages (
    run_id, source_id, canonical_url, official_external_id,
    title, starts_on, ends_on, reason_code
  )
  select p_run_id, p_source_id, held.canonical_url,
    held.official_external_id, held.title, held.starts_on,
    held.ends_on, held.reason_code
  from jsonb_to_recordset(p_held_pages) as held(
    canonical_url text,
    official_external_id text,
    title text,
    starts_on date,
    ends_on date,
    reason_code text
  );

  return public.commit_owned_official_import_candidate_batch(
    p_run_id, p_source_id, p_attempt_token, p_candidates
  );
end;
$$;

revoke execute on function public.commit_owned_official_import_partial_batch(
  uuid, text, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.commit_owned_official_import_partial_batch(
  uuid, text, text, jsonb, jsonb
) to service_role;
