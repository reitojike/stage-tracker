-- Issue #825 P1b. Registration remains disabled; no existing share is bound,
-- revoked, or converted. Legacy email creation and read policies are unchanged.
begin;

alter table public.personal_schedule_shares
  add column contact_id uuid references public.schedule_contacts(id) on delete cascade;
create index personal_schedule_shares_contact_id_idx
  on public.personal_schedule_shares(contact_id) where contact_id is not null;

create table public.schedule_contact_aliases (
  contact_id uuid not null references public.schedule_contacts(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  alias text not null check (alias = btrim(alias) and length(alias) between 1 and 80),
  primary key (contact_id, owner_id)
);
create index schedule_contact_aliases_owner_idx on public.schedule_contact_aliases(owner_id);
alter table public.schedule_contact_aliases enable row level security;
revoke all on public.schedule_contact_aliases from public, anon, authenticated;
grant select, insert, update, delete on public.schedule_contact_aliases to service_role;

-- Account locks precede pair and relationship locks, including while an
-- account deletion is cascading through requests/contacts/shares.
create function private.lock_schedule_contact(p_contact_id uuid, p_actor uuid)
returns public.schedule_contacts
language plpgsql
set search_path = ''
as $$
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
$$;
revoke all on function private.lock_schedule_contact(uuid, uuid)
  from public, anon, authenticated;

create function private.validate_schedule_contact_alias()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
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
$$;
revoke all on function private.validate_schedule_contact_alias() from public, anon, authenticated;
create trigger schedule_contact_aliases_validate
  before insert or update on public.schedule_contact_aliases
  for each row execute function private.validate_schedule_contact_alias();

create function private.validate_schedule_share_contact()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
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
$$;
revoke all on function private.validate_schedule_share_contact() from public, anon, authenticated;
create trigger personal_schedule_shares_validate_contact
  before insert or update on public.personal_schedule_shares
  for each row execute function private.validate_schedule_share_contact();

create function public.list_received_schedule_contact_requests()
returns table (request_id uuid, requester_email text, requested_at timestamptz)
language plpgsql security definer
set search_path = ''
as $$
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
$$;

create function public.list_schedule_contacts()
returns table (contact_id uuid, counterpart_email text, own_alias text, accepted_at timestamptz)
language plpgsql security definer
set search_path = ''
as $$
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
$$;

create function public.set_schedule_contact_alias(p_contact_id uuid, p_alias text)
returns void
language plpgsql security definer
set search_path = ''
as $$
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
$$;

create function public.share_schedule_entry_with_contact(p_schedule_entry_id uuid, p_contact_id uuid)
returns public.personal_schedule_shares
language plpgsql security definer
set search_path = ''
as $$
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
$$;

create function public.unlink_schedule_contact(p_contact_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.list_received_schedule_contact_requests(),
  public.list_schedule_contacts(), public.set_schedule_contact_alias(uuid, text),
  public.share_schedule_entry_with_contact(uuid, uuid), public.unlink_schedule_contact(uuid)
  from public, anon;
grant execute on function public.list_received_schedule_contact_requests(),
  public.list_schedule_contacts(), public.set_schedule_contact_alias(uuid, text),
  public.share_schedule_entry_with_contact(uuid, uuid), public.unlink_schedule_contact(uuid)
  to authenticated;

comment on column public.personal_schedule_shares.contact_id is
  'Accepted contact generation for the new, disabled contact share path. Legacy NULL rows are unchanged until a separately approved cutover.';

commit;
