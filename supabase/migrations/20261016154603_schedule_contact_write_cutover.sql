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
