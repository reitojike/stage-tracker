-- Issue #825, P1a: additive, disabled registration foundation only.
-- No existing schedule table, share RPC, grant, policy, or data is changed.
begin;

create table public.schedule_contact_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  requested_email text not null,
  user_low_id uuid generated always as (least(requester_id, recipient_id)) stored,
  user_high_id uuid generated always as (greatest(requester_id, recipient_id)) stored,
  created_at timestamptz not null default now(),
  constraint schedule_contact_requests_not_self check (requester_id <> recipient_id),
  constraint schedule_contact_requests_email_normalized check (
    requested_email = lower(btrim(requested_email))
    and length(requested_email) <= 320
    and requested_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  constraint schedule_contact_requests_pair_key unique (user_low_id, user_high_id)
);

create index schedule_contact_requests_recipient_idx
  on public.schedule_contact_requests (recipient_id, created_at, id);
create index schedule_contact_requests_requester_email_idx
  on public.schedule_contact_requests (requester_id, requested_email);

-- A row is an accepted relationship, never a pending or historical record.
-- A fresh UUID on every later acceptance is its generation/epoch identity.
create table public.schedule_contacts (
  id uuid primary key default gen_random_uuid(),
  user_low_id uuid not null references auth.users(id) on delete cascade,
  user_high_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint schedule_contacts_ordered_pair check (user_low_id < user_high_id),
  constraint schedule_contacts_pair_key unique (user_low_id, user_high_id)
);
create index schedule_contacts_user_high_idx
  on public.schedule_contacts (user_high_id);

-- One bounded counter per caller, including syntactically valid unknown/no-op
-- attempts. No target emails or target-dependent history are stored here.
create table private.schedule_contact_request_budgets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  attempts integer not null check (attempts between 1 and 11)
);

alter table public.schedule_contact_requests enable row level security;
alter table public.schedule_contacts enable row level security;
alter table private.schedule_contact_request_budgets enable row level security;

-- No direct client CRUD, including SELECT: a sender must not distinguish real
-- pending requests from unknown-address no-ops by inspecting rows or counts.
revoke all on public.schedule_contact_requests, public.schedule_contacts,
  private.schedule_contact_request_budgets from public, anon, authenticated;
grant select, insert, update, delete on public.schedule_contact_requests,
  public.schedule_contacts to service_role;

-- Migration-owned release gate, not a caller-controlled setting. Enabling this
-- requires a later reviewed migration AFTER bounded reads, unlink/share locking,
-- timing/privacy evidence, prepared runtime, and closure of the old email RPC.
create function public.schedule_contact_registration_enabled()
returns boolean
language sql immutable
set search_path = ''
as $$ select false; $$;
revoke all on function public.schedule_contact_registration_enabled() from public, anon;
grant execute on function public.schedule_contact_registration_enabled() to authenticated;

create function private.require_schedule_contact_registration()
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.schedule_contact_registration_enabled() then
    raise exception 'schedule contact registration is not enabled' using errcode = '0A000';
  end if;
  -- Keep the caller FK alive until commit, including a concurrent account
  -- deletion. KEY SHARE locks are compatible across reciprocal requests.
  perform 1 from auth.users u
    where u.id = v_actor and u.deleted_at is null for key share;
  if not found then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;
revoke all on function private.require_schedule_contact_registration()
  from public, anon, authenticated;

-- Advisory locks survive deletion of request/contact rows. All future contact
-- and share operations must use this same namespace and canonical pair order.
create function private.lock_schedule_contact_pair(p_a uuid, p_b uuid)
returns void
language sql
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'schedule-contact:' || least(p_a, p_b)::text || ':' || greatest(p_a, p_b)::text, 0
  ));
$$;
revoke all on function private.lock_schedule_contact_pair(uuid, uuid)
  from public, anon, authenticated;

create function private.consume_schedule_contact_request_budget(p_actor uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_attempts integer;
begin
  insert into private.schedule_contact_request_budgets as b
    (user_id, window_started_at, attempts)
  values (p_actor, v_now, 1)
  on conflict (user_id) do update set
    window_started_at = case when b.window_started_at <= v_now - interval '10 minutes'
      then v_now else b.window_started_at end,
    attempts = case when b.window_started_at <= v_now - interval '10 minutes'
      then 1 else least(b.attempts + 1, 11) end
  returning attempts into v_attempts;
  return v_attempts <= 10;
end;
$$;
revoke all on function private.consume_schedule_contact_request_budget(uuid)
  from public, anon, authenticated;

create function public.request_schedule_contact_by_email(p_recipient_email text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_schedule_contact_registration();
  v_email text := lower(btrim(p_recipient_email));
  v_recipient uuid;
begin
  if v_email is null or length(v_email) > 320
    or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid email address' using errcode = '22023';
  end if;

  -- The budget lock is acquired before any pair lock. Unknown, duplicate, and
  -- reverse requests consume the same caller budget and return the same void.
  if not private.consume_schedule_contact_request_budget(v_actor) then
    return;
  end if;
  select u.id into v_recipient from auth.users u
    where lower(u.email) = v_email and u.deleted_at is null limit 1 for key share;
  if v_recipient = v_actor then
    raise exception 'cannot request yourself' using errcode = '22023';
  end if;
  if v_recipient is null then
    return;
  end if;
  perform private.lock_schedule_contact_pair(v_actor, v_recipient);
  -- Re-check deletion after waiting for the pair lock.
  if not exists (select 1 from auth.users u
    where u.id = v_recipient and u.deleted_at is null) then
    return;
  end if;
  if exists (select 1 from public.schedule_contacts c
    where c.user_low_id = least(v_actor, v_recipient)
      and c.user_high_id = greatest(v_actor, v_recipient)) then
    return;
  end if;
  insert into public.schedule_contact_requests
    (requester_id, recipient_id, requested_email)
  values (v_actor, v_recipient, v_email)
  on conflict (user_low_id, user_high_id) do nothing;
end;
$$;

create function public.accept_schedule_contact_request(p_request_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_schedule_contact_registration();
  v_request public.schedule_contact_requests;
begin
  select * into v_request from public.schedule_contact_requests r
    where r.id = p_request_id and r.recipient_id = v_actor;
  if not found then return; end if;
  -- Lock the other account BEFORE deleting its request. Otherwise a user
  -- deletion could hold the account lock while its cascade waits for this
  -- request row, and acceptance would wait for that same account's FK lock.
  perform 1 from auth.users u
    where u.id = v_request.requester_id and u.deleted_at is null for key share;
  if not found then return; end if;
  perform private.lock_schedule_contact_pair(v_request.requester_id, v_actor);
  -- Delete only this generation, after locking; cancel/decline/another accept
  -- may have removed it while this transaction waited.
  delete from public.schedule_contact_requests r
    where r.id = p_request_id and r.recipient_id = v_actor
    returning * into v_request;
  if not found then return; end if;
  insert into public.schedule_contacts (user_low_id, user_high_id)
  values (v_request.user_low_id, v_request.user_high_id)
  on conflict (user_low_id, user_high_id) do nothing;
end;
$$;

create function public.decline_schedule_contact_request(p_request_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_schedule_contact_registration();
  v_request public.schedule_contact_requests;
begin
  select * into v_request from public.schedule_contact_requests r
    where r.id = p_request_id and r.recipient_id = v_actor;
  if not found then return; end if;
  perform private.lock_schedule_contact_pair(v_request.requester_id, v_actor);
  delete from public.schedule_contact_requests r
    where r.id = p_request_id and r.recipient_id = v_actor;
end;
$$;

create function public.cancel_schedule_contact_request_by_email(p_recipient_email text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_schedule_contact_registration();
  v_email text := lower(btrim(p_recipient_email));
  v_request public.schedule_contact_requests;
begin
  if v_email is null or length(v_email) > 320
    or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid email address' using errcode = '22023';
  end if;
  -- Match the original caller-supplied address, not the account's current
  -- email. Multiple matches after email reuse are cancelled in canonical
  -- order; a concurrent fresh request has a different ID and is not deleted.
  for v_request in
    select * from public.schedule_contact_requests r
    where r.requester_id = v_actor and r.requested_email = v_email
    order by r.user_low_id, r.user_high_id
  loop
    perform private.lock_schedule_contact_pair(v_actor, v_request.recipient_id);
    delete from public.schedule_contact_requests r
      where r.id = v_request.id and r.requester_id = v_actor;
  end loop;
end;
$$;

revoke all on function public.request_schedule_contact_by_email(text),
  public.accept_schedule_contact_request(uuid),
  public.decline_schedule_contact_request(uuid),
  public.cancel_schedule_contact_request_by_email(text) from public, anon;
grant execute on function public.request_schedule_contact_by_email(text),
  public.accept_schedule_contact_request(uuid),
  public.decline_schedule_contact_request(uuid),
  public.cancel_schedule_contact_request_by_email(text) to authenticated;

comment on table public.schedule_contacts is
  'Accepted schedule-contact generations. Registration is disabled; this table grants no schedule visibility.';
comment on table public.schedule_contact_requests is
  'Current pending requests only; no sender-readable existence/history projection. Registration is disabled.';

commit;
