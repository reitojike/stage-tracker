-- Issue #825 P3: runtime-first-required. Preserve existing reads/revoke grants.
-- No accepted backfill, existing-share binding, expiry, or P4 read changes.
begin;
set local lock_timeout = '10s';

-- Drain INSERT transactions before publishing the new INSERT boundary. An
-- old email invocation still before INSERT must meet the new trigger later.
lock table public.personal_schedule_shares in share row exclusive mode;

do $$
declare
  v_rpc text;
  v_expected record;
  -- Exact foundation body from 20261016021552; normalize line endings only.
  -- Unexpected deployed code is a HOLD, never silently overwritten here.
  v_validator_body constant text := $validator$
declare
  v_owner uuid;
begin
  if tg_op = 'UPDATE' and old.contact_id is not null then
    if new.contact_id is distinct from old.contact_id
      or new.schedule_entry_id <> old.schedule_entry_id
      or new.shared_with_user_id <> old.shared_with_user_id then
      raise exception 'bound share identity is immutable' using errcode = '23514';
    end if;
    -- The binding cannot change, and the FK still enforces its lifetime.
    -- Avoid taking a pair lock after an UPDATE has already locked this row.
    return new;
  end if;
  if new.contact_id is null then return new; end if;
  select e.owner_id into v_owner from public.personal_schedule_entries e
    where e.id = new.schedule_entry_id;
  if v_owner is null or v_owner = new.shared_with_user_id then
    raise exception 'share contact participants do not match' using errcode = '23514';
  end if;
  perform 1 from auth.users u where u.id in (v_owner, new.shared_with_user_id)
    order by u.id for key share;
  perform private.lock_schedule_contact_pair(v_owner, new.shared_with_user_id);
  perform 1 from public.schedule_contacts c
    where c.id = new.contact_id
      and c.user_low_id = least(v_owner, new.shared_with_user_id)
      and c.user_high_id = greatest(v_owner, new.shared_with_user_id)
    for key share;
  if not found then
    raise exception 'share contact participants do not match' using errcode = '23514';
  end if;
  return new;
end;
$validator$;
begin
  if (select count(*) from pg_catalog.pg_proc p
      where p.proname = 'share_schedule_entry_by_email') <> 1
    or pg_catalog.to_regprocedure('public.share_schedule_entry_by_email(uuid,text)') is null then
    raise exception 'unexpected legacy sharing overloads; inventory required' using errcode = '55000';
  end if;
  -- Finite P1a/P1b registration inventory: acceptance and its callees must
  -- still have the reviewed bodies. Grants alone cannot prove mutual consent.
  -- Do not replace or repair unexpected deployed functions during cutover.
  for v_expected in select * from (values
    ('public.schedule_contact_registration_enabled()', 'sql', 'boolean', false, 'i', false, $contract$ select false; $contract$),
    ('private.require_schedule_contact_registration()', 'plpgsql', 'uuid', false, 'v', false, $contract$
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
$contract$),
    ('private.lock_schedule_contact_pair(uuid,uuid)', 'sql', 'void', false, 'v', false, $contract$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'schedule-contact:' || least(p_a, p_b)::text || ':' || greatest(p_a, p_b)::text, 0
  ));
$contract$),
    ('private.consume_schedule_contact_request_budget(uuid)', 'plpgsql', 'boolean', false, 'v', false, $contract$
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
$contract$),
    ('public.request_schedule_contact_by_email(text)', 'plpgsql', 'void', true, 'v', false, $contract$
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
$contract$),
    ('public.accept_schedule_contact_request(uuid)', 'plpgsql', 'void', true, 'v', false, $contract$
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
$contract$),
    ('public.decline_schedule_contact_request(uuid)', 'plpgsql', 'void', true, 'v', false, $contract$
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
$contract$),
    ('public.cancel_schedule_contact_request_by_email(text)', 'plpgsql', 'void', true, 'v', false, $contract$
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
$contract$),
    ('private.lock_schedule_contact(uuid,uuid)', 'plpgsql', 'public.schedule_contacts', false, 'v', false, $contract$
declare
  v_contact public.schedule_contacts;
begin
  select * into v_contact from public.schedule_contacts c
    where c.id = p_contact_id and p_actor in (c.user_low_id, c.user_high_id);
  if not found then return null; end if;
  perform 1 from auth.users u
    where u.id in (v_contact.user_low_id, v_contact.user_high_id)
    order by u.id for key share;
  perform private.lock_schedule_contact_pair(v_contact.user_low_id, v_contact.user_high_id);
  select * into v_contact from public.schedule_contacts c
    where c.id = p_contact_id and p_actor in (c.user_low_id, c.user_high_id)
    for key share;
  return v_contact;
end;
$contract$),
    ('private.validate_schedule_contact_alias()', 'plpgsql', 'trigger', true, 'v', false, $contract$
begin
  if tg_op = 'UPDATE' and (new.contact_id <> old.contact_id or new.owner_id <> old.owner_id) then
    raise exception 'alias identity is immutable' using errcode = '23514';
  end if;
  if not exists (select 1 from public.schedule_contacts c
    where c.id = new.contact_id and new.owner_id in (c.user_low_id, c.user_high_id)) then
    raise exception 'alias owner must be a contact participant' using errcode = '23514';
  end if;
  return new;
end;
$contract$),
    ('public.list_received_schedule_contact_requests()', 'plpgsql', 'record', true, 'v', true, $contract$
declare
  v_actor uuid := private.require_schedule_contact_registration();
begin
  return query
  select r.id, lower(u.email), r.created_at
    from public.schedule_contact_requests r
    join auth.users u on u.id = r.requester_id and u.deleted_at is null
    where r.recipient_id = v_actor
    order by r.created_at, r.id;
end;
$contract$),
    ('public.list_schedule_contacts()', 'plpgsql', 'record', true, 'v', true, $contract$
declare
  v_actor uuid := private.require_schedule_contact_registration();
begin
  return query
  select c.id, lower(u.email), a.alias, c.created_at
    from public.schedule_contacts c
    join auth.users u on u.id = case when c.user_low_id = v_actor
      then c.user_high_id else c.user_low_id end and u.deleted_at is null
    left join public.schedule_contact_aliases a on a.contact_id = c.id and a.owner_id = v_actor
    where v_actor in (c.user_low_id, c.user_high_id)
    order by c.created_at, c.id;
end;
$contract$),
    ('public.set_schedule_contact_alias(uuid,text)', 'plpgsql', 'void', true, 'v', false, $contract$
declare
  v_actor uuid := private.require_schedule_contact_registration();
  v_contact public.schedule_contacts;
  v_alias text := nullif(btrim(p_alias), '');
begin
  v_contact := private.lock_schedule_contact(p_contact_id, v_actor);
  if v_contact.id is null then
    raise exception 'schedule contact is unavailable' using errcode = '42501';
  end if;
  if v_alias is null then
    delete from public.schedule_contact_aliases a
      where a.contact_id = p_contact_id and a.owner_id = v_actor;
  elsif length(v_alias) > 80 then
    raise exception 'alias is too long' using errcode = '22023';
  else
    insert into public.schedule_contact_aliases(contact_id, owner_id, alias)
      values (p_contact_id, v_actor, v_alias)
      on conflict (contact_id, owner_id) do update set alias = excluded.alias;
  end if;
end;
$contract$),
    ('public.share_schedule_entry_with_contact(uuid,uuid)', 'plpgsql', 'public.personal_schedule_shares', true, 'v', false, $contract$
declare
  v_actor uuid := private.require_schedule_contact_registration();
  v_contact public.schedule_contacts;
  v_recipient uuid;
  v_share public.personal_schedule_shares;
begin
  v_contact := private.lock_schedule_contact(p_contact_id, v_actor);
  if v_contact.id is null then
    raise exception 'schedule contact is unavailable' using errcode = '42501';
  end if;
  v_recipient := case when v_contact.user_low_id = v_actor
    then v_contact.user_high_id else v_contact.user_low_id end;
  if not exists (select 1 from auth.users u where u.id = v_recipient and u.deleted_at is null) then
    raise exception 'schedule contact is unavailable' using errcode = '42501';
  end if;
  perform 1 from public.personal_schedule_entries e
    where e.id = p_schedule_entry_id and e.owner_id = v_actor for key share;
  if not found then
    raise exception 'schedule entry is unavailable' using errcode = '42501';
  end if;
  insert into public.personal_schedule_shares(schedule_entry_id, shared_with_user_id, contact_id)
    values (p_schedule_entry_id, v_recipient, p_contact_id)
    on conflict (schedule_entry_id, shared_with_user_id)
    do update set contact_id = excluded.contact_id
    returning * into v_share;
  return v_share;
end;
$contract$),
    ('public.unlink_schedule_contact(uuid)', 'plpgsql', 'void', true, 'v', false, $contract$
declare
  v_actor uuid := private.require_schedule_contact_registration();
  v_contact public.schedule_contacts;
begin
  v_contact := private.lock_schedule_contact(p_contact_id, v_actor);
  if v_contact.id is null then return; end if;
  -- Include both directions and legacy NULL bindings; never delete entries.
  delete from public.personal_schedule_shares s using public.personal_schedule_entries e
    where e.id = s.schedule_entry_id
      and ((e.owner_id = v_contact.user_low_id and s.shared_with_user_id = v_contact.user_high_id)
        or (e.owner_id = v_contact.user_high_id and s.shared_with_user_id = v_contact.user_low_id));
  delete from public.schedule_contact_requests r
    where r.user_low_id = v_contact.user_low_id and r.user_high_id = v_contact.user_high_id;
  delete from public.schedule_contacts c where c.id = p_contact_id;
end;
$contract$)
  ) as expected(signature, language, return_type, definer, volatility, returns_set, body)
  loop
    if not exists (select 1 from pg_catalog.pg_proc p
      where p.oid = pg_catalog.to_regprocedure(v_expected.signature)
        and p.prokind = 'f' and p.proowner = 'postgres'::regrole
        and p.prolang = (select oid from pg_catalog.pg_language where lanname = v_expected.language)
        and p.prorettype = v_expected.return_type::regtype
        and p.proretset = v_expected.returns_set and p.prosecdef = v_expected.definer
        and p.proconfig = array['search_path=""']
        and p.provolatile::text = v_expected.volatility and p.proparallel = 'u'
        and not p.proisstrict and not p.proleakproof
        and replace(p.prosrc, E'\r\n', E'\n') = replace(v_expected.body, E'\r\n', E'\n')) then
      raise exception 'registration function definition differs: %; inventory required',
        v_expected.signature using errcode = '55000';
    end if;
  end loop;
  -- An unchanged OID/trigger is insufficient after CREATE OR REPLACE FUNCTION.
  if not exists (select 1 from pg_catalog.pg_proc p
    where p.oid = 'private.validate_schedule_share_contact()'::regprocedure
      and p.prokind = 'f' and p.pronargs = 0
      and p.prorettype = 'pg_catalog.trigger'::regtype
      and p.prolang = (select oid from pg_catalog.pg_language where lanname = 'plpgsql')
      and p.proowner = 'postgres'::regrole and p.prosecdef
      and p.proconfig = array['search_path=""']
      and p.provolatile = 'v' and p.proparallel = 'u'
      and not p.proisstrict and not p.proleakproof
      and replace(p.prosrc, E'\r\n', E'\n') = replace(v_validator_body, E'\r\n', E'\n'))
    or has_function_privilege('anon', 'private.validate_schedule_share_contact()', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.validate_schedule_share_contact()', 'EXECUTE') then
    raise exception 'accepted generation validator definition differs; inventory required' using errcode = '55000';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.personal_schedule_shares'::regclass
      and t.tgname = 'personal_schedule_shares_validate_contact'
      and t.tgfoid = 'private.validate_schedule_share_contact()'::regprocedure
      and t.tgenabled in ('O', 'A') and t.tgtype = 23 and not t.tgisinternal
      and t.tgqual is null and t.tgnargs = 0 and t.tgattr = ''::int2vector) then
    raise exception 'accepted generation validation is unavailable' using errcode = '55000';
  end if;
  if not exists (select 1 from pg_catalog.pg_proc p
    where p.oid = 'public.share_schedule_entry_with_contact(uuid,uuid)'::regprocedure
      and p.prosecdef and p.proconfig @> array['search_path=""'])
    or has_function_privilege('anon', 'public.share_schedule_entry_with_contact(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.schedule_contact_registration_enabled()', 'EXECUTE') then
    raise exception 'accepted sharing boundary differs; inventory required' using errcode = '55000';
  end if;
  foreach v_rpc in array array[
    'schedule_contact_registration_enabled()', 'request_schedule_contact_by_email(text)',
    'accept_schedule_contact_request(uuid)', 'decline_schedule_contact_request(uuid)',
    'cancel_schedule_contact_request_by_email(text)', 'list_received_schedule_contact_requests()',
    'list_schedule_contacts()', 'set_schedule_contact_alias(uuid,text)',
    'share_schedule_entry_with_contact(uuid,uuid)', 'unlink_schedule_contact(uuid)'
  ] loop
    if not has_function_privilege('authenticated', 'public.' || v_rpc, 'EXECUTE')
      or has_function_privilege('anon', 'public.' || v_rpc, 'EXECUTE') then
      raise exception 'registration RPC privilege differs; inventory required' using errcode = '55000';
    end if;
  end loop;
end;
$$;

-- Keep the signature for a bounded rollback-compatible runtime, but deny even
-- privileged wrappers that invoke it. ACL revocation alone cannot do that.
create or replace function public.share_schedule_entry_by_email(
  p_schedule_entry_id uuid,
  p_recipient_email text
) returns public.personal_schedule_shares
language plpgsql security invoker set search_path = ''
as $$
begin
  raise exception 'legacy email sharing is closed' using errcode = '42501';
end;
$$;
revoke all on function public.share_schedule_entry_by_email(uuid,text)
  from public, anon, authenticated;

-- Existing NULL bindings remain readable and removable. Only new rows are
-- forbidden, including privileged old callers and emergency gate=false.
create function private.require_new_schedule_share_contact()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.contact_id is null then
    raise exception 'new shares require an accepted contact generation' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.require_new_schedule_share_contact() from public, anon, authenticated;
create trigger personal_schedule_shares_require_contact
before insert on public.personal_schedule_shares
for each row execute function private.require_new_schedule_share_contact();

revoke insert, update on public.personal_schedule_shares from public, anon, authenticated;
do $$
declare
  v_columns text;
  v_role text;
begin
  select string_agg(format('%I', a.attname), ', ' order by a.attnum) into v_columns
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.personal_schedule_shares'::regclass
    and a.attnum > 0 and not a.attisdropped;
  foreach v_role in array array['public', 'anon', 'authenticated'] loop
    execute format('revoke insert (%s), update (%s) on public.personal_schedule_shares from %I',
      v_columns, v_columns, v_role);
  end loop;
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, 'public.share_schedule_entry_by_email(uuid,text)', 'EXECUTE')
      or has_table_privilege(v_role, 'public.personal_schedule_shares', 'INSERT,UPDATE')
      or has_any_column_privilege(v_role, 'public.personal_schedule_shares', 'INSERT,UPDATE') then
      raise exception 'inherited legacy sharing privilege remains; inventory required' using errcode = '55000';
    end if;
  end loop;
  if not has_function_privilege('authenticated',
    'public.share_schedule_entry_with_contact(uuid,uuid)', 'EXECUTE') then
    raise exception 'accepted sharing RPC is unavailable' using errcode = '55000';
  end if;
end;
$$;

-- No client GUC/environment/administrative UI bypass. This transaction owns
-- the switch, after the legacy creation boundary is closed and verified.
create or replace function public.schedule_contact_registration_enabled()
returns boolean language sql immutable set search_path = ''
as $$ select true; $$;

notify pgrst, 'reload schema';
commit;
