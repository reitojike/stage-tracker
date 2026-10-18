-- Issue #825 P4: bind existing shares to current, explicitly accepted contacts.
-- Apply only after the P3 runtime/write cutover and a clean, approved inventory.
-- Unknown code, privileges, policies, constraints, or data abort the transaction;
-- this migration never creates consent, repairs stale bindings, or drops shares.
begin;
set local lock_timeout = '10s';
set local search_path = '';

-- Drain account mutations first; active accounts cannot change during binding.
-- Child locks MUST be NOWAIT: a writer can already hold a child/FK lock while
-- waiting for auth.users. Waiting on that child would invert this lock order.
-- A 55P03 leaves all changes rolled back; retry only after the writer drains.
lock table auth.users in exclusive mode;
lock table public.personal_schedule_entries in share row exclusive mode nowait;
lock table public.schedule_contacts in share row exclusive mode nowait;
lock table public.personal_schedule_shares in access exclusive mode nowait;

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
  -- Finite P3 registration inventory: acceptance and its callees must
  -- still have the reviewed bodies. Grants alone cannot prove mutual consent.
  -- Do not replace or repair unexpected deployed functions during cutover.
  for v_expected in select * from (values
    ('public.schedule_contact_registration_enabled()', 'sql', 'boolean', false, 'i', false, null::text[], null::oid[], null::"char"[], $contract$ select true; $contract$),
    ('private.require_schedule_contact_registration()', 'plpgsql', 'uuid', false, 'v', false, null::text[], null::oid[], null::"char"[], $contract$
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
    ('private.lock_schedule_contact_pair(uuid,uuid)', 'sql', 'void', false, 'v', false, array['p_a','p_b']::text[], null::oid[], null::"char"[], $contract$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'schedule-contact:' || least(p_a, p_b)::text || ':' || greatest(p_a, p_b)::text, 0
  ));
$contract$),
    ('private.consume_schedule_contact_request_budget(uuid)', 'plpgsql', 'boolean', false, 'v', false, array['p_actor']::text[], null::oid[], null::"char"[], $contract$
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
    ('public.request_schedule_contact_by_email(text)', 'plpgsql', 'void', true, 'v', false, array['p_recipient_email']::text[], null::oid[], null::"char"[], $contract$
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
    ('public.accept_schedule_contact_request(uuid)', 'plpgsql', 'void', true, 'v', false, array['p_request_id']::text[], null::oid[], null::"char"[], $contract$
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
    ('public.decline_schedule_contact_request(uuid)', 'plpgsql', 'void', true, 'v', false, array['p_request_id']::text[], null::oid[], null::"char"[], $contract$
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
    ('public.cancel_schedule_contact_request_by_email(text)', 'plpgsql', 'void', true, 'v', false, array['p_recipient_email']::text[], null::oid[], null::"char"[], $contract$
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
    ('private.lock_schedule_contact(uuid,uuid)', 'plpgsql', 'public.schedule_contacts', false, 'v', false, array['p_contact_id','p_actor']::text[], null::oid[], null::"char"[], $contract$
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
    ('private.validate_schedule_contact_alias()', 'plpgsql', 'trigger', true, 'v', false, null::text[], null::oid[], null::"char"[], $contract$
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
    ('public.list_received_schedule_contact_requests()', 'plpgsql', 'record', true, 'v', true, array['request_id','requester_email','requested_at']::text[], array['uuid'::regtype::oid,'text'::regtype::oid,'timestamptz'::regtype::oid]::oid[], array['t','t','t']::"char"[], $contract$
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
    ('public.list_schedule_contacts()', 'plpgsql', 'record', true, 'v', true, array['contact_id','counterpart_email','own_alias','accepted_at']::text[], array['uuid'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'timestamptz'::regtype::oid]::oid[], array['t','t','t','t']::"char"[], $contract$
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
    ('public.set_schedule_contact_alias(uuid,text)', 'plpgsql', 'void', true, 'v', false, array['p_contact_id','p_alias']::text[], null::oid[], null::"char"[], $contract$
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
    ('public.share_schedule_entry_with_contact(uuid,uuid)', 'plpgsql', 'public.personal_schedule_shares', true, 'v', false, array['p_schedule_entry_id','p_contact_id']::text[], null::oid[], null::"char"[], $contract$
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
    ('public.unlink_schedule_contact(uuid)', 'plpgsql', 'void', true, 'v', false, array['p_contact_id']::text[], null::oid[], null::"char"[], $contract$
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
,
    ('public.share_schedule_entry_by_email(uuid,text)', 'plpgsql', 'public.personal_schedule_shares', false, 'v', false, array['p_schedule_entry_id','p_recipient_email']::text[], null::oid[], null::"char"[], $contract$
begin
  raise exception 'legacy email sharing is closed' using errcode = '42501';
end;
$contract$),
    ('private.require_new_schedule_share_contact()', 'plpgsql', 'trigger', false, 'v', false, null::text[], null::oid[], null::"char"[], $contract$
begin
  if new.contact_id is null then
    raise exception 'new shares require an accepted contact generation' using errcode = '42501';
  end if;
  return new;
end;
$contract$),
    ('public.is_personal_schedule_entry_owner(uuid)', 'sql', 'boolean', true, 's', false, array['p_entry_id']::text[], null::oid[], null::"char"[], $contract$
  select exists (
    select 1
    from public.personal_schedule_entries e
    where e.id = p_entry_id
      and e.owner_id = auth.uid()
  );
$contract$),
    ('public.list_schedule_share_recipient_emails(uuid)', 'plpgsql', 'record', true, 's', true, array['p_schedule_entry_id','share_id','recipient_email','shared_at']::text[], array['uuid'::regtype::oid,'uuid'::regtype::oid,'text'::regtype::oid,'timestamptz'::regtype::oid]::oid[], array['i','t','t','t']::"char"[], $contract$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not public.is_personal_schedule_entry_owner(p_schedule_entry_id) then
    raise exception 'only the schedule entry owner can view recipient emails';
  end if;

  return query
  select s.id, lower(u.email), s.created_at
  from public.personal_schedule_shares s
  join auth.users u on u.id = s.shared_with_user_id
  where s.schedule_entry_id = p_schedule_entry_id
  order by s.created_at, s.id;
end;
$contract$)
  ) as expected(signature, language, return_type, definer, volatility, returns_set,
    argument_names, all_argument_types, argument_modes, body)
  loop
    if (select count(*) from pg_catalog.pg_proc p
        where (p.pronamespace, p.proname) = (select q.pronamespace, q.proname
          from pg_catalog.pg_proc q where q.oid = pg_catalog.to_regprocedure(v_expected.signature))) <> 1 then
      raise exception 'unexpected function overloads: %; inventory required',
        v_expected.signature using errcode = '55000';
    end if;
    if not exists (select 1 from pg_catalog.pg_proc p
      where p.oid = pg_catalog.to_regprocedure(v_expected.signature)
        and p.prokind = 'f' and p.proowner = 'postgres'::regrole
        and p.pronargdefaults = 0 and p.provariadic = 0
        and p.proargnames is not distinct from v_expected.argument_names
        and p.proallargtypes is not distinct from v_expected.all_argument_types
        and p.proargmodes is not distinct from v_expected.argument_modes
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

-- The read boundary is a finite inventory, not an ACL repair pass. In
-- particular, an extra permissive SELECT/ALL policy would bypass the cutover.
do $$
declare
  v_expected record;
  v_role text;
  v_table regclass;
  v_function text;
begin
  if exists (select 1 from pg_catalog.pg_proc p
    where p.proname = 'can_read_current_schedule_share'
      and p.pronamespace = (select c.relnamespace from pg_catalog.pg_class c
        where c.oid = 'private.schedule_contact_request_budgets'::regclass)) then
    raise exception 'read helper already exists; inventory required' using errcode = '55000';
  end if;
  foreach v_table in array array[
    'public.personal_schedule_entries'::regclass, 'public.personal_schedule_shares'::regclass,
    'public.schedule_contacts'::regclass, 'public.schedule_contact_requests'::regclass,
    'public.schedule_contact_aliases'::regclass, 'private.schedule_contact_request_budgets'::regclass
  ] loop
    if not exists (select 1 from pg_catalog.pg_class c where c.oid = v_table
      and c.relkind = 'r' and c.relowner = 'postgres'::regrole
      and c.relrowsecurity and not c.relforcerowsecurity) then
      raise exception 'table ownership/RLS differs: %; inventory required', v_table using errcode = '55000';
    end if;
  end loop;
  if exists (select 1 from pg_catalog.pg_policy p where p.polrelid in (
    'public.schedule_contacts'::regclass, 'public.schedule_contact_requests'::regclass,
    'public.schedule_contact_aliases'::regclass, 'private.schedule_contact_request_budgets'::regclass))
    or (select count(*) from pg_catalog.pg_policy p
      where p.polrelid = 'public.personal_schedule_entries'::regclass) <> 4
    or (select count(*) from pg_catalog.pg_policy p
      where p.polrelid = 'public.personal_schedule_shares'::regclass) <> 2 then
    raise exception 'unexpected schedule/contact policies; inventory required' using errcode = '55000';
  end if;
  for v_expected in select * from (values
    ('public.personal_schedule_entries'::regclass, 'personal_schedule_entries_select_owner_or_shared', 'r',
      $policy$((owner_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.personal_schedule_shares s
  WHERE ((s.schedule_entry_id = personal_schedule_entries.id) AND (s.shared_with_user_id = auth.uid())))))$policy$, null::text),
    ('public.personal_schedule_entries'::regclass, 'personal_schedule_entries_insert_own', 'a', null::text, '(owner_id = auth.uid())'),
    ('public.personal_schedule_entries'::regclass, 'personal_schedule_entries_update_own', 'w', '(owner_id = auth.uid())', '(owner_id = auth.uid())'),
    ('public.personal_schedule_entries'::regclass, 'personal_schedule_entries_delete_own', 'd', '(owner_id = auth.uid())', null::text),
    ('public.personal_schedule_shares'::regclass, 'personal_schedule_shares_select_owner_or_recipient', 'r',
      '((shared_with_user_id = auth.uid()) OR public.is_personal_schedule_entry_owner(schedule_entry_id))', null::text),
    ('public.personal_schedule_shares'::regclass, 'personal_schedule_shares_delete_owner_or_self', 'd',
      '((shared_with_user_id = auth.uid()) OR public.is_personal_schedule_entry_owner(schedule_entry_id))', null::text)
  ) as expected(relation, name, command, qual, check_qual)
  loop
    if not exists (select 1 from pg_catalog.pg_policy p
      where p.polrelid = v_expected.relation and p.polname = v_expected.name
        and p.polcmd::text = v_expected.command and p.polpermissive
        and p.polroles = array['authenticated'::regrole::oid]
        and pg_catalog.pg_get_expr(p.polqual, p.polrelid) is not distinct from v_expected.qual
        and pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) is not distinct from v_expected.check_qual) then
      raise exception 'schedule policy differs: %; inventory required', v_expected.name using errcode = '55000';
    end if;
  end loop;

  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_catalog.pg_roles r
      where (r.rolsuper or r.rolbypassrls) and pg_catalog.pg_has_role(v_role, r.oid, 'MEMBER')) then
      raise exception 'client elevated role membership differs; inventory required' using errcode = '55000';
    end if;
    if has_function_privilege(v_role, 'public.share_schedule_entry_by_email(uuid,text)', 'EXECUTE')
      or has_table_privilege(v_role, 'public.personal_schedule_shares', 'INSERT,UPDATE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(v_role, 'public.personal_schedule_shares', 'INSERT,UPDATE,REFERENCES') then
      raise exception 'effective direct sharing write privilege differs; inventory required' using errcode = '55000';
    end if;
    if has_table_privilege(v_role, 'public.personal_schedule_entries', 'INSERT,UPDATE,TRUNCATE,REFERENCES,TRIGGER')
      or has_column_privilege(v_role, 'public.personal_schedule_entries', 'owner_id', 'UPDATE')
      or has_column_privilege(v_role, 'public.personal_schedule_entries', 'id', 'INSERT,UPDATE') then
      raise exception 'effective schedule ownership write privilege differs; inventory required' using errcode = '55000';
    end if;
    foreach v_table in array array[
      'public.schedule_contacts'::regclass, 'public.schedule_contact_requests'::regclass,
      'public.schedule_contact_aliases'::regclass, 'private.schedule_contact_request_budgets'::regclass
    ] loop
      if has_table_privilege(v_role, v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege(v_role, v_table, 'SELECT,INSERT,UPDATE,REFERENCES') then
        raise exception 'effective client contact privilege differs: %; inventory required', v_table using errcode = '55000';
      end if;
    end loop;
    foreach v_function in array array[
      'private.require_schedule_contact_registration()', 'private.lock_schedule_contact_pair(uuid,uuid)',
      'private.consume_schedule_contact_request_budget(uuid)', 'private.lock_schedule_contact(uuid,uuid)',
      'private.validate_schedule_contact_alias()', 'private.validate_schedule_share_contact()',
      'private.require_new_schedule_share_contact()'
    ] loop
      if has_function_privilege(v_role, v_function, 'EXECUTE') then
        raise exception 'effective private helper privilege differs: %; inventory required', v_function using errcode = '55000';
      end if;
    end loop;
  end loop;
  -- These older functions revoked PUBLIC, but not Supabase's explicit
  -- bootstrap grants. Read-only inventories establish exactly two baselines:
  -- production has postgres/authenticated; fresh local/CI also has anon and
  -- service_role. Preserve either ACL without repairing it. Their exact bodies
  -- above check auth.uid()/ownership before any projection, including for anon.
  foreach v_function in array array[
    'public.is_personal_schedule_entry_owner(uuid)', 'public.list_schedule_share_recipient_emails(uuid)'
  ] loop
    if not exists (select 1 from pg_catalog.pg_proc p
      where p.oid = pg_catalog.to_regprocedure(v_function)
        and (select array_agg(x.grantee::regrole::text order by x.grantee::regrole::text)
          from pg_catalog.aclexplode(p.proacl) x) in (
            array['authenticated','postgres']::text[],
            array['anon','authenticated','postgres','service_role']::text[])
        and not exists (select 1 from pg_catalog.aclexplode(p.proacl) x
          where x.grantor <> 'postgres'::regrole or x.privilege_type <> 'EXECUTE' or x.is_grantable)
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and has_function_privilege('anon', p.oid, 'EXECUTE') = exists (
          select 1 from pg_catalog.aclexplode(p.proacl) x where x.grantee = 'anon'::regrole)) then
      raise exception 'effective schedule read privilege differs: %; inventory required', v_function using errcode = '55000';
    end if;
  end loop;
  if not has_table_privilege('authenticated', 'public.personal_schedule_shares', 'SELECT')
    or not has_table_privilege('authenticated', 'public.personal_schedule_shares', 'DELETE')
    or not has_table_privilege('authenticated', 'public.personal_schedule_entries', 'SELECT')
    or has_table_privilege('anon', 'public.personal_schedule_shares', 'SELECT,DELETE')
    or has_any_column_privilege('anon', 'public.personal_schedule_shares', 'SELECT')
    or has_table_privilege('anon', 'public.personal_schedule_entries', 'SELECT')
    or has_any_column_privilege('anon', 'public.personal_schedule_entries', 'SELECT,INSERT,UPDATE,REFERENCES')
    or has_table_privilege('anon', 'public.personal_schedule_entries', 'DELETE') then
    raise exception 'schedule read/revoke privileges differ; inventory required' using errcode = '55000';
  end if;

  -- Exact known user triggers; unreviewed triggers can manufacture consent or
  -- alter the rows being bound even when the named validator still exists.
  if (select count(*) from pg_catalog.pg_trigger t where not t.tgisinternal
      and t.tgrelid = 'public.personal_schedule_shares'::regclass) <> 2
    or exists (select 1 from pg_catalog.pg_trigger t where not t.tgisinternal
      and t.tgrelid in ('public.schedule_contacts'::regclass, 'public.schedule_contact_requests'::regclass))
    or (select count(*) from pg_catalog.pg_trigger t where not t.tgisinternal
      and t.tgrelid = 'public.schedule_contact_aliases'::regclass) <> 1 then
    raise exception 'unexpected contact/share triggers; inventory required' using errcode = '55000';
  end if;
  for v_expected in select * from (values
    ('public.personal_schedule_shares'::regclass, 'personal_schedule_shares_validate_contact', 'private.validate_schedule_share_contact()'::regprocedure, 23),
    ('public.personal_schedule_shares'::regclass, 'personal_schedule_shares_require_contact', 'private.require_new_schedule_share_contact()'::regprocedure, 7),
    ('public.schedule_contact_aliases'::regclass, 'schedule_contact_aliases_validate', 'private.validate_schedule_contact_alias()'::regprocedure, 23)
  ) as expected(relation, name, function_oid, type)
  loop
    if not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = v_expected.relation
      and t.tgname = v_expected.name and t.tgfoid = v_expected.function_oid
      and t.tgtype = v_expected.type and t.tgenabled = 'O' and not t.tgisinternal
      and t.tgqual is null and t.tgnargs = 0 and t.tgattr = ''::int2vector
      and not t.tgdeferrable and not t.tginitdeferred
      and t.tgoldtable is null and t.tgnewtable is null) then
      raise exception 'contact/share trigger differs: %; inventory required', v_expected.name using errcode = '55000';
    end if;
  end loop;

  if (select count(*) from pg_catalog.pg_constraint c
      where c.conrelid = 'public.personal_schedule_shares'::regclass) <> 5
    or (select count(*) from pg_catalog.pg_constraint c
      where c.conrelid = 'public.schedule_contacts'::regclass) <> 5 then
    raise exception 'unexpected share/contact constraints; inventory required' using errcode = '55000';
  end if;
  for v_expected in select * from (values
    ('public.personal_schedule_shares'::regclass, 'personal_schedule_shares_schedule_entry_id_fkey', 'schedule_entry_id', 'public.personal_schedule_entries'::regclass),
    ('public.personal_schedule_shares'::regclass, 'personal_schedule_shares_shared_with_user_id_fkey', 'shared_with_user_id', 'auth.users'::regclass),
    ('public.personal_schedule_shares'::regclass, 'personal_schedule_shares_contact_id_fkey', 'contact_id', 'public.schedule_contacts'::regclass),
    ('public.personal_schedule_entries'::regclass, 'personal_schedule_entries_owner_id_fkey', 'owner_id', 'auth.users'::regclass),
    ('public.schedule_contacts'::regclass, 'schedule_contacts_user_low_id_fkey', 'user_low_id', 'auth.users'::regclass),
    ('public.schedule_contacts'::regclass, 'schedule_contacts_user_high_id_fkey', 'user_high_id', 'auth.users'::regclass)
  ) as expected(relation, name, column_name, referenced_relation)
  loop
    if not exists (select 1 from pg_catalog.pg_constraint c
      where c.conrelid = v_expected.relation and c.conname = v_expected.name and c.contype = 'f'
        and c.confrelid = v_expected.referenced_relation
        and c.conkey = array[(select a.attnum from pg_catalog.pg_attribute a
          where a.attrelid = v_expected.relation and a.attname = v_expected.column_name and not a.attisdropped)]
        and c.confkey = array[(select a.attnum from pg_catalog.pg_attribute a
          where a.attrelid = v_expected.referenced_relation and a.attname = 'id' and not a.attisdropped)]
        and c.convalidated and not c.condeferrable and not c.condeferred
        and c.confdeltype = 'c' and c.confupdtype = 'a' and c.confmatchtype = 's'
        and (select count(*) from pg_catalog.pg_trigger t
          where t.tgconstraint = c.oid and t.tgisinternal and t.tgenabled = 'O') = 4
        and not exists (select 1 from pg_catalog.pg_trigger t
          where t.tgconstraint = c.oid and (not t.tgisinternal or t.tgenabled <> 'O'))
        and exists (select 1 from pg_catalog.pg_index i
          where i.indexrelid = c.conindid and i.indisvalid and i.indisready and i.indislive)) then
      raise exception 'contact/share FK differs: %; inventory required', v_expected.name using errcode = '55000';
    end if;
  end loop;
  for v_expected in select * from (values
    ('public.personal_schedule_shares'::regclass, 'personal_schedule_shares_pkey', 'p', array['id']::text[]),
    ('public.personal_schedule_shares'::regclass, 'personal_schedule_shares_schedule_entry_id_shared_with_user_key', 'u', array['schedule_entry_id','shared_with_user_id']::text[]),
    ('public.schedule_contacts'::regclass, 'schedule_contacts_pkey', 'p', array['id']::text[]),
    ('public.schedule_contacts'::regclass, 'schedule_contacts_pair_key', 'u', array['user_low_id','user_high_id']::text[])
  ) as expected(relation, name, type, columns)
  loop
    if not exists (select 1 from pg_catalog.pg_constraint c
      join pg_catalog.pg_index i on i.indexrelid = c.conindid
      where c.conrelid = v_expected.relation and c.conname = v_expected.name
        and c.contype::text = v_expected.type and c.convalidated
        and not c.condeferrable and not c.condeferred
        and (select array_agg(a.attname::text order by k.ordinality)
          from unnest(c.conkey) with ordinality k(attnum, ordinality)
          join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
          = v_expected.columns
        and i.indisvalid and i.indisready and i.indislive and i.indisunique
        and i.indpred is null and i.indexprs is null) then
      raise exception 'contact/share unique key differs: %; inventory required', v_expected.name using errcode = '55000';
    end if;
  end loop;
  if not exists (select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.schedule_contacts'::regclass and c.conname = 'schedule_contacts_ordered_pair'
      and c.contype = 'c' and c.convalidated and not c.connoinherit
      and pg_catalog.pg_get_expr(c.conbin, c.conrelid) = '(user_low_id < user_high_id)')
    or not exists (select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.personal_schedule_shares'::regclass and a.attname = 'contact_id'
        and a.atttypid = 'uuid'::regtype and not a.attnotnull and not a.attisdropped) then
    raise exception 'canonical contact/share shape differs; inventory required' using errcode = '55000';
  end if;
  if (select count(*) from pg_catalog.pg_attribute a
      where a.attrelid = 'public.personal_schedule_shares'::regclass and a.attnum > 0 and not a.attisdropped) <> 5
    or (select count(*) from pg_catalog.pg_attribute a
      where a.attrelid = 'public.schedule_contacts'::regclass and a.attnum > 0 and not a.attisdropped) <> 4 then
    raise exception 'unexpected contact/share columns; inventory required' using errcode = '55000';
  end if;
  for v_expected in select * from (values
    ('public.personal_schedule_shares'::regclass, 'id', 'uuid'::regtype, true),
    ('public.personal_schedule_shares'::regclass, 'schedule_entry_id', 'uuid'::regtype, true),
    ('public.personal_schedule_shares'::regclass, 'shared_with_user_id', 'uuid'::regtype, true),
    ('public.personal_schedule_shares'::regclass, 'created_at', 'timestamptz'::regtype, true),
    ('public.personal_schedule_shares'::regclass, 'contact_id', 'uuid'::regtype, false),
    ('public.schedule_contacts'::regclass, 'id', 'uuid'::regtype, true),
    ('public.schedule_contacts'::regclass, 'user_low_id', 'uuid'::regtype, true),
    ('public.schedule_contacts'::regclass, 'user_high_id', 'uuid'::regtype, true),
    ('public.schedule_contacts'::regclass, 'created_at', 'timestamptz'::regtype, true),
    ('public.personal_schedule_entries'::regclass, 'owner_id', 'uuid'::regtype, true)
  ) as expected(relation, name, type, not_null)
  loop
    if not exists (select 1 from pg_catalog.pg_attribute a
      where a.attrelid = v_expected.relation and a.attname = v_expected.name
        and a.atttypid = v_expected.type and a.attnotnull = v_expected.not_null
        and a.attgenerated = '' and not a.attisdropped) then
      raise exception 'contact/share column differs: %; inventory required', v_expected.name using errcode = '55000';
    end if;
  end loop;
  -- Request/acceptance omit id. Reused defaults would let a cached old accept
  -- target a new request, or resurrect a contact generation after reacceptance.
  foreach v_table in array array[
    'public.schedule_contacts'::regclass, 'public.schedule_contact_requests'::regclass
  ] loop
    if not exists (select 1 from pg_catalog.pg_attribute a
      join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = v_table and a.attname = 'id'
        and a.atttypid = 'uuid'::regtype and a.attnotnull
        and a.attidentity = '' and a.attgenerated = '' and not a.attisdropped
        and pg_catalog.pg_get_expr(d.adbin, d.adrelid) = 'gen_random_uuid()') then
      raise exception 'registration generation default differs: %; inventory required', v_table using errcode = '55000';
    end if;
  end loop;
  if not exists (select 1 from pg_catalog.pg_index i
    join pg_catalog.pg_class idx on idx.oid = i.indexrelid
    join pg_catalog.pg_am am on am.oid = idx.relam
    where i.indexrelid = pg_catalog.to_regclass('public.personal_schedule_shares_contact_id_idx')
      and i.indrelid = 'public.personal_schedule_shares'::regclass
      and i.indisvalid and i.indisready and i.indislive and not i.indisunique
      and i.indnkeyatts = 1 and i.indnatts = 1 and i.indexprs is null
      and i.indkey::text = (select a.attnum::text from pg_catalog.pg_attribute a
        where a.attrelid = i.indrelid and a.attname = 'contact_id' and not a.attisdropped)
      and pg_catalog.pg_get_expr(i.indpred, i.indrelid) = '(contact_id IS NOT NULL)'
      and am.amname = 'btree') then
    raise exception 'share contact index differs; inventory required' using errcode = '55000';
  end if;
end;
$$;

-- Validate before touching any row. A NULL may bind only to an existing
-- accepted canonical pair; a non-NULL must already identify that exact pair.
-- Soft deletion counts as unavailable even while auth.users still exists.
do $$
begin
  if exists (select 1 from public.schedule_contacts c
    left join auth.users lo on lo.id = c.user_low_id
    left join auth.users hi on hi.id = c.user_high_id
    where c.user_low_id >= c.user_high_id or lo.id is null or hi.id is null
      or lo.deleted_at is not null or hi.deleted_at is not null)
    or exists (select 1 from public.personal_schedule_shares s
      left join public.personal_schedule_entries e on e.id = s.schedule_entry_id
      left join auth.users owner_account on owner_account.id = e.owner_id
      left join auth.users recipient_account on recipient_account.id = s.shared_with_user_id
      left join public.schedule_contacts c
        on c.user_low_id = least(e.owner_id, s.shared_with_user_id)
          and c.user_high_id = greatest(e.owner_id, s.shared_with_user_id)
      where e.id is null or e.owner_id = s.shared_with_user_id
        or owner_account.id is null or recipient_account.id is null
        or owner_account.deleted_at is not null or recipient_account.deleted_at is not null
        or c.id is null or (s.contact_id is not null and s.contact_id <> c.id)) then
    raise exception 'share/contact data is not eligible for read cutover; inventory required' using errcode = '55000';
  end if;
end;
$$;

update public.personal_schedule_shares s
set contact_id = c.id
from public.personal_schedule_entries e, public.schedule_contacts c
where s.contact_id is null and e.id = s.schedule_entry_id
  and c.user_low_id = least(e.owner_id, s.shared_with_user_id)
  and c.user_high_id = greatest(e.owner_id, s.shared_with_user_id);

alter table public.personal_schedule_shares alter column contact_id set not null;

-- Only a persisted share's primary key is accepted. SECURITY DEFINER breaks
-- the entries -> shares -> entries RLS cycle; identity, consent generation,
-- both live accounts, and the current caller are all rechecked inside it.
create function private.can_read_current_schedule_share(p_share_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.personal_schedule_shares s
    join public.personal_schedule_entries e on e.id = s.schedule_entry_id
    join public.schedule_contacts c on c.id = s.contact_id
      and c.user_low_id = least(e.owner_id, s.shared_with_user_id)
      and c.user_high_id = greatest(e.owner_id, s.shared_with_user_id)
    join auth.users owner_account on owner_account.id = e.owner_id and owner_account.deleted_at is null
    join auth.users recipient_account on recipient_account.id = s.shared_with_user_id and recipient_account.deleted_at is null
    where s.id = p_share_id and e.owner_id <> s.shared_with_user_id
      and auth.uid() in (e.owner_id, s.shared_with_user_id)
  );
$$;
alter function private.can_read_current_schedule_share(uuid) owner to postgres;
revoke all on function private.can_read_current_schedule_share(uuid) from public, anon, authenticated;
grant execute on function private.can_read_current_schedule_share(uuid) to authenticated;
-- No private schema USAGE grant: the stored policy resolves this helper's OID.

drop policy personal_schedule_shares_select_owner_or_recipient on public.personal_schedule_shares;
create policy personal_schedule_shares_select_owner_or_recipient
  on public.personal_schedule_shares for select to authenticated
  using (private.can_read_current_schedule_share(id));

-- The entry SELECT policy stays structurally unchanged. Its existing shares
-- subquery now inherits the exact same current-consent predicate through RLS.
create or replace function public.list_schedule_share_recipient_emails(p_schedule_entry_id uuid)
returns table (share_id uuid, recipient_email text, shared_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not public.is_personal_schedule_entry_owner(p_schedule_entry_id) then
    raise exception 'only the schedule entry owner can view recipient emails';
  end if;

  return query
  select s.id, lower(u.email), s.created_at
  from public.personal_schedule_shares s
  join auth.users u on u.id = s.shared_with_user_id
  where s.schedule_entry_id = p_schedule_entry_id
    and private.can_read_current_schedule_share(s.id)
  order by s.created_at, s.id;
end;
$$;

do $$
begin
  if exists (select 1 from public.personal_schedule_shares s
    left join public.personal_schedule_entries e on e.id = s.schedule_entry_id
    left join public.schedule_contacts c on c.id = s.contact_id
    left join auth.users owner_account on owner_account.id = e.owner_id
    left join auth.users recipient_account on recipient_account.id = s.shared_with_user_id
    where s.contact_id is null or e.id is null or c.id is null
      or e.owner_id = s.shared_with_user_id
      or c.user_low_id <> least(e.owner_id, s.shared_with_user_id)
      or c.user_high_id <> greatest(e.owner_id, s.shared_with_user_id)
      or owner_account.id is null or recipient_account.id is null
      or owner_account.deleted_at is not null or recipient_account.deleted_at is not null)
    or not exists (select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.personal_schedule_shares'::regclass and a.attname = 'contact_id'
        and a.attnotnull and not a.attisdropped)
    or not public.schedule_contact_registration_enabled() then
    raise exception 'read cutover data/gate postcondition failed' using errcode = '55000';
  end if;
  if not exists (select 1 from pg_catalog.pg_proc p
    where p.oid = 'private.can_read_current_schedule_share(uuid)'::regprocedure
      and p.proowner = 'postgres'::regrole and p.prosecdef and p.provolatile = 's'
      and p.proconfig = array['search_path=""'] and p.prorettype = 'boolean'::regtype
      -- CREATE FUNCTION also inherits custom default EXECUTE grants. Reject
      -- every unknown grantee/grantor/grant option rather than repairing it.
      and (select array_agg(x.grantee::regrole::text order by x.grantee::regrole::text)
        from pg_catalog.aclexplode(p.proacl) x) = array['authenticated','postgres']::text[]
      and not exists (select 1 from pg_catalog.aclexplode(p.proacl) x
        where x.grantor <> 'postgres'::regrole or x.privilege_type <> 'EXECUTE' or x.is_grantable))
    or not has_function_privilege('authenticated', 'private.can_read_current_schedule_share(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'private.can_read_current_schedule_share(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.share_schedule_entry_by_email(uuid,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.share_schedule_entry_by_email(uuid,text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.list_schedule_share_recipient_emails(uuid)', 'EXECUTE')
    -- CREATE OR REPLACE preserves the source-known legacy projection ACL.
    -- Anonymous execution on the fresh local baseline still fails its exact
    -- auth.uid() check; the new private helper never grants anonymous EXECUTE.
    or not exists (select 1 from pg_catalog.pg_proc p
      where p.oid = 'public.list_schedule_share_recipient_emails(uuid)'::regprocedure
        and (select array_agg(x.grantee::regrole::text order by x.grantee::regrole::text)
          from pg_catalog.aclexplode(p.proacl) x) in (
            array['authenticated','postgres']::text[],
            array['anon','authenticated','postgres','service_role']::text[])
        and not exists (select 1 from pg_catalog.aclexplode(p.proacl) x
          where x.grantor <> 'postgres'::regrole or x.privilege_type <> 'EXECUTE' or x.is_grantable)
        and has_function_privilege('anon', p.oid, 'EXECUTE') = exists (
          select 1 from pg_catalog.aclexplode(p.proacl) x where x.grantee = 'anon'::regrole))
    or has_table_privilege('authenticated', 'public.personal_schedule_shares', 'INSERT,UPDATE')
    or has_any_column_privilege('authenticated', 'public.personal_schedule_shares', 'INSERT,UPDATE')
    or not exists (select 1 from pg_catalog.pg_policy p
      where p.polrelid = 'public.personal_schedule_shares'::regclass
        and p.polname = 'personal_schedule_shares_select_owner_or_recipient'
        and p.polcmd = 'r' and p.polpermissive and p.polroles = array['authenticated'::regrole::oid]
        and pg_catalog.pg_get_expr(p.polqual, p.polrelid) = 'private.can_read_current_schedule_share(id)'
        and p.polwithcheck is null)
    or exists (select 1 from pg_catalog.pg_class c
      where c.oid in ('public.personal_schedule_entries'::regclass,
        'public.personal_schedule_shares'::regclass, 'public.schedule_contacts'::regclass)
        and not c.relrowsecurity) then
    raise exception 'read cutover ACL/RLS postcondition failed' using errcode = '55000';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
