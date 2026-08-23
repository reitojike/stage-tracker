-- Email-based recipient targeting and a bounded recipient-email read
-- projection for personal schedule sharing (Issue #55, unblocking #37).
--
-- Product decision (Issue #55): MVP authenticated-user targeting for #37
-- sharing is the recipient's exact registered email address, never a raw
-- internal user id from a client, and never a generic user directory.
-- public.personal_schedule_shares (20260822000000_create_personal_schedule.sql,
-- Issue #31/#33) keeps shared_with_user_id as its persisted identity - this
-- migration adds only the two operation-specific boundaries #37's UI needs
-- around it:
--
--   1. share_schedule_entry_by_email: owner adds a recipient by email.
--   2. list_schedule_share_recipient_emails: owner reads the emails of
--      recipients already shared with, for the recipient-removal UI.
--
-- Unlike #36 invitation, sharing has no invitee-side private state to
-- protect - a share row's mere existence *is* the shared fact, and it is
-- already readable by its owner via personal_schedule_shares_select_owner_
-- or_recipient (raw shared_with_user_id, no email). So share_schedule_
-- entry_by_email is not required to be opaque about whether the target
-- email is a registered account: an owner sharing with a real recipient
-- they know needs to learn if the email was mistyped, and there is no
-- comparable third-party private state this could leak (contrast #36,
-- where the same email lookup sits behind an occurrence the invitee may
-- not want the inviter to learn anything about).

-- Resolves p_recipient_email to a registered, non-deleted auth.users id and
-- adds them as a share recipient of p_schedule_entry_id, as its owner.
-- SECURITY DEFINER is what makes the auth.users lookup possible at all (the
-- authenticated role has no grant on that table - see the revoke/grant at
-- the bottom) - and, because SECURITY DEFINER also bypasses this table's
-- RLS, this function must re-check ownership itself
-- (is_personal_schedule_entry_owner) exactly as personal_schedule_shares_
-- insert_owner would; skipping that check would let any authenticated
-- caller add a recipient to an entry they do not own.
--
-- Idempotent: re-sharing with an already-shared recipient returns the
-- existing row rather than erroring or duplicating it, mirroring this
-- table's own unique constraint - a share is a fact ("has this entry been
-- shared with this person"), not an event log.
create function public.share_schedule_entry_by_email(
  p_schedule_entry_id uuid,
  p_recipient_email text
) returns public.personal_schedule_shares
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_owner_email text;
  v_recipient_email text;
  v_recipient_id uuid;
  v_share public.personal_schedule_shares;
begin
  -- Defense-in-depth: EXECUTE is restricted to authenticated below (never
  -- PUBLIC/anon), so this should be unreachable in practice.
  if v_owner_id is null then
    raise exception 'authentication required';
  end if;

  if p_schedule_entry_id is null or p_recipient_email is null or btrim(p_recipient_email) = '' then
    raise exception 'schedule entry and recipient email are required';
  end if;

  if not public.is_personal_schedule_entry_owner(p_schedule_entry_id) then
    raise exception 'only the schedule entry owner can add a recipient';
  end if;

  v_recipient_email := lower(btrim(p_recipient_email));

  -- A format sanity check, not a full RFC 5322 validator - mirrors
  -- invite_to_occurrence_by_email's same check.
  if v_recipient_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'recipient email is not a valid email address';
  end if;

  select lower(u.email) into v_owner_email
  from auth.users u
  where u.id = v_owner_id;

  if v_owner_email is not null and v_owner_email = v_recipient_email then
    raise exception 'cannot share with yourself';
  end if;

  select u.id into v_recipient_id
  from auth.users u
  where lower(u.email) = v_recipient_email
    and u.deleted_at is null
  limit 1;

  -- No pending/external share for an unregistered email (Issue #55
  -- decision: registered-account-only targeting for #37) - reported
  -- plainly, unlike #36's opaque no-op, for the reason in this migration's
  -- header.
  if v_recipient_id is null then
    raise exception 'recipient email is not a registered account';
  end if;

  insert into public.personal_schedule_shares (schedule_entry_id, shared_with_user_id)
  values (p_schedule_entry_id, v_recipient_id)
  on conflict (schedule_entry_id, shared_with_user_id) do nothing
  returning * into v_share;

  if not found then
    select s.* into v_share
    from public.personal_schedule_shares s
    where s.schedule_entry_id = p_schedule_entry_id
      and s.shared_with_user_id = v_recipient_id;
  end if;

  return v_share;
end;
$$;

revoke execute on function public.share_schedule_entry_by_email(uuid, text) from public;
grant execute on function public.share_schedule_entry_by_email(uuid, text) to authenticated;

-- A bounded read projection: the recipient emails of one schedule entry's
-- existing shares, for its owner only - the owner-facing counterpart to
-- share_schedule_entry_by_email above, so the recipient-removal UI can
-- identify a recipient by email rather than by raw id. This is not a
-- general user directory: the row set is exactly personal_schedule_shares
-- rows already scoped to p_schedule_entry_id (the same rows
-- personal_schedule_shares_select_owner_or_recipient already lets this
-- owner read, minus the email projection PostgREST cannot express without
-- an auth.users join no grant permits) - SECURITY DEFINER only adds the
-- email column, not a wider row set. Ownership is re-checked here for the
-- same reason share_schedule_entry_by_email re-checks it: SECURITY DEFINER
-- bypasses this table's own RLS, so skipping the check would let any
-- authenticated caller read any entry's recipient emails.
create function public.list_schedule_share_recipient_emails(p_schedule_entry_id uuid)
returns table (share_id uuid, recipient_email text, shared_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
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
  order by s.created_at, s.id;
end;
$$;

revoke execute on function public.list_schedule_share_recipient_emails(uuid) from public;
grant execute on function public.list_schedule_share_recipient_emails(uuid) to authenticated;
