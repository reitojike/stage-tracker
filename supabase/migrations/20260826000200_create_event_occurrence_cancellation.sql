-- Event / Occurrence cancellation lifecycle (Issue #125, PO decision #123).
--
-- Product semantics (product-rules.md "Cancellation", decided by #123):
-- - Cancellation is deliberately distinct from hard deletion (#124): a
--   canceled Event/Occurrence keeps every row - itself and every downstream
--   participation/invitation/ticket_acquisitions/tickets/transfers - and
--   stays reachable in the shared catalog, marked as canceled rather than
--   removed.
-- - Event-level and Occurrence-level cancellation are independent booleans
--   that compose with OR ("effective cancellation"): canceling the Event
--   does not set any child Occurrence's own flag, and un-canceling the
--   Event does not clear any child Occurrence's own flag either - #123 is
--   explicit that Event uncancel must not auto-uncancel Occurrences.
-- - Only the exact moment of transition ever needs to be recorded, and only
--   whether it is currently canceled (not-null) or not (null) carries
--   product meaning - no audit/history table, matching the "cancellation
--   専用audit/history frameworkはMVPでは作らない" line in the Issue body.
--   A nullable `canceled_at timestamptz` column is therefore sufficient,
--   mirroring `occurrence_invitations.declined_at`'s "null = not yet"
--   convention (20260822010100_create_occurrence_invitations.sql) rather
--   than introducing a separate boolean.
--
-- Write boundary: canceled_at is exposed as a normal column-level UPDATE
-- grant (like events.starts_on/ends_on, event_occurrences.starts_at/
-- ends_at), gated by the *existing* events_update_own /
-- event_occurrences_update_own RLS policies (owner-only). No new RPC is
-- needed for the toggle itself: unlike hard deletion (#124), which had to
-- guard a destructive, irreversible, cross-table operation, cancel/uncancel
-- is a single-column, always-reversible write with no downstream
-- cross-table effect to keep atomic. The exact stored instant carries no
-- product meaning beyond "is this null" (see above), so there is nothing an
-- RPC would need to compute or protect that a plain owner-gated UPDATE does
-- not already give for free.
alter table public.events add column canceled_at timestamptz;
alter table public.event_occurrences add column canceled_at timestamptz;

grant update (canceled_at) on public.events to authenticated;
grant update (canceled_at) on public.event_occurrences to authenticated;

-- Effective cancellation (product-rules.md: "Event canceled OR Occurrence
-- canceled"), as a single reusable predicate rather than re-deriving the OR
-- at every call site. STABLE (not SECURITY DEFINER): both tables already
-- grant SELECT to authenticated on every row (shared catalog), so this
-- needs no elevated privilege - it is a convenience wrapper around two reads
-- any caller could already perform directly.
create function public.event_occurrence_is_effectively_canceled(p_occurrence_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.event_occurrences eo
    join public.events e on e.id = eo.event_id
    where eo.id = p_occurrence_id
      and (e.canceled_at is not null or eo.canceled_at is not null)
  );
$$;

revoke execute on function public.event_occurrence_is_effectively_canceled(uuid) from public;
grant execute on function public.event_occurrence_is_effectively_canceled(uuid) to authenticated;

-- Custom SQLSTATE 90002: application-defined condition for "this action is
-- rejected because the target occurrence is currently effectively
-- canceled". Distinct from 42501 (insufficient_privilege, an *actor*
-- problem - not owning/being the row) and from 90001
-- (20260826000100_create_event_delete_rpcs.sql's delete-blocked, a
-- downstream-data problem): this is neither - the actor may otherwise be
-- fully eligible, but the target's current cancellation *state* forbids a
-- new active commitment right now. PostgREST propagates this code to the
-- client's error.code field, same as 90001.
--
-- Race-safety: unlike 20260825000200_add_event_range_containment_
-- triggers.sql's constraint triggers, the checks below take no explicit row
-- lock on events/event_occurrences. That cross-table containment invariant
-- must hold for every committed row forever (a range update must never
-- leave an existing occurrence outside it), so a bare read there really
-- could race against a concurrent range change and let both commit. The
-- guards here are a different kind of check: a point-in-time gate ("was
-- this occurrence effectively canceled at the moment this write
-- committed"), not a standing invariant over already-committed rows. Each
-- guard's read is part of the same transaction as the write it gates, so it
-- always reflects the writer's own transaction-consistent view; the only
-- possible race is "a concurrent cancel commits a few milliseconds before
-- or after this write" - ordinary last-committed-wins behavior, not a
-- correctness violation, and not worth serializing every participation/
-- ticket-acquisition insert against every event/occurrence row for.
create function public.check_occurrence_participation_insert_not_canceled() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.event_occurrence_is_effectively_canceled(new.occurrence_id) then
    raise exception
      'this occurrence is effectively canceled: a new participation cannot be created'
      using errcode = '90002';
  end if;
  return new;
end;
$$;

create trigger occurrence_participations_reject_insert_when_canceled
  before insert on public.occurrence_participations
  for each row
  execute function public.check_occurrence_participation_insert_not_canceled();

-- Only the transition *into* `attending` is guarded (product-rules.md
-- "considering -> attending等のactive方向update"), not every update to an
-- already-canceled occurrence's participation row: a same-status save (e.g.
-- toggling visibility) or a downgrade to `considering` is never a new
-- active commitment, and product-rules.md explicitly keeps withdrawal
-- (DELETE, a separate grant/policy entirely) available regardless of
-- cancellation - freezing unrelated updates on a canceled occurrence would
-- go beyond what was decided.
create function public.check_occurrence_participation_update_not_canceled() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'attending'::public.participation_status
    and old.status is distinct from new.status
    and public.event_occurrence_is_effectively_canceled(new.occurrence_id)
  then
    raise exception
      'this occurrence is effectively canceled: participation cannot be set to attending'
      using errcode = '90002';
  end if;
  return new;
end;
$$;

create trigger occurrence_participations_reject_attending_when_canceled
  before update on public.occurrence_participations
  for each row
  execute function public.check_occurrence_participation_update_not_canceled();

-- New ticket_acquisitions rows are the only guarded ticket-acquisition
-- action (product-rules.md "新規ticket acquisitionを拒否"). Existing
-- acquisitions/tickets/transfers are read/managed exactly as before -
-- cancellation never auto-changes their status (see this migration's
-- header) - so no UPDATE-side guard is added here, matching how the
-- participation guard above only touches the `attending` transition, not
-- every update.
create function public.check_ticket_acquisition_insert_not_canceled() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.event_occurrence_is_effectively_canceled(new.occurrence_id) then
    raise exception
      'this occurrence is effectively canceled: a new ticket acquisition cannot be created'
      using errcode = '90002';
  end if;
  return new;
end;
$$;

create trigger ticket_acquisitions_reject_insert_when_canceled
  before insert on public.ticket_acquisitions
  for each row
  execute function public.check_ticket_acquisition_insert_not_canceled();

-- invite_to_occurrence / invite_to_occurrence_by_email are the only create
-- paths for occurrence_invitations (no INSERT grant/policy exists on that
-- table at all - see 20260822010100_create_occurrence_invitations.sql), so
-- the new-invitation guard belongs inside these RPCs rather than as a table
-- trigger. CREATE OR REPLACE keeps each function's existing signature,
-- SECURITY DEFINER, and settle-loop/opacity behavior unchanged - see
-- 20260822010200_create_invite_to_occurrence_rpc.sql and
-- 20260823010000_create_invite_to_occurrence_by_email_rpc.sql for the parts
-- reproduced verbatim below; only the new cancellation check is added, in
-- both functions right after the caller-fact self-invite check and before
-- the "must be attending" eligibility check - a canceled occurrence rejects
-- a new invitation regardless of the inviter's own eligibility, and this
-- ordering means that is the reason reported first.
--
-- This check is purely about the *occurrence's* state, never the invitee's
-- participation, so raising here (rather than returning void) does not
-- reopen the opacity boundary these functions otherwise preserve: the
-- rejection is identical for every invitee, resolved or not.
create or replace function public.invite_to_occurrence(
  p_occurrence_id uuid,
  p_invitee_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inviter_id uuid := auth.uid();
  v_existing_declined_at timestamptz;
  v_invitee_status public.participation_status;
  v_settled boolean := false;
begin
  if v_inviter_id is null then
    raise exception 'authentication required';
  end if;

  if p_occurrence_id is null or p_invitee_id is null then
    raise exception 'occurrence and invitee are required';
  end if;

  if p_invitee_id = v_inviter_id then
    raise exception 'cannot invite yourself';
  end if;

  if public.event_occurrence_is_effectively_canceled(p_occurrence_id) then
    raise exception
      'this occurrence is effectively canceled: a new invitation cannot be created'
      using errcode = '90002';
  end if;

  if not exists (
    select 1
    from public.occurrence_participations inviter_participation
    where inviter_participation.occurrence_id = p_occurrence_id
      and inviter_participation.user_id = v_inviter_id
      and inviter_participation.status = 'attending'::public.participation_status
  ) then
    raise exception 'only a user attending this occurrence can invite others to it';
  end if;

  select existing.declined_at into v_existing_declined_at
  from public.occurrence_invitations existing
  where existing.occurrence_id = p_occurrence_id
    and existing.inviter_id = v_inviter_id
    and existing.invitee_id = p_invitee_id;
  if found then
    if v_existing_declined_at is not null then
      raise exception
        'this invitation was declined; re-inviting is not a supported operation';
    end if;
    return;
  end if;

  for v_attempt in 1..3 loop
    select invitee_participation.status into v_invitee_status
    from public.occurrence_participations invitee_participation
    where invitee_participation.occurrence_id = p_occurrence_id
      and invitee_participation.user_id = p_invitee_id
    for update;

    if found then
      if v_invitee_status = 'attending'::public.participation_status then
        return;
      end if;
      v_settled := true;
    else
      begin
        insert into public.occurrence_participations (occurrence_id, user_id, status)
        values (p_occurrence_id, p_invitee_id, 'considering'::public.participation_status);
        v_settled := true;
      exception when unique_violation then
        v_settled := false;
      end;
    end if;

    exit when v_settled;
  end loop;

  if not v_settled then
    raise exception 'could not settle invitee participation state for this occurrence';
  end if;

  insert into public.occurrence_invitations (occurrence_id, inviter_id, invitee_id)
  values (p_occurrence_id, v_inviter_id, p_invitee_id)
  on conflict (occurrence_id, inviter_id, invitee_id) do nothing;

  if not found then
    if not exists (
      select 1
      from public.occurrence_invitations existing
      where existing.occurrence_id = p_occurrence_id
        and existing.inviter_id = v_inviter_id
        and existing.invitee_id = p_invitee_id
    ) then
      raise exception 'invitation could not be created or resolved';
    end if;
  end if;
end;
$$;

revoke execute on function public.invite_to_occurrence(uuid, uuid) from public;
grant execute on function public.invite_to_occurrence(uuid, uuid) to authenticated;

create or replace function public.invite_to_occurrence_by_email(
  p_occurrence_id uuid,
  p_invitee_email text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inviter_id uuid := auth.uid();
  v_inviter_email text;
  v_invitee_email text;
  v_invitee_id uuid;
  v_existing_invitation_id uuid;
  v_invitee_status public.participation_status;
  v_settled boolean := false;
  v_attempt int;
begin
  if v_inviter_id is null then
    raise exception 'authentication required';
  end if;

  if p_occurrence_id is null or p_invitee_email is null or btrim(p_invitee_email) = '' then
    raise exception 'occurrence and invitee email are required';
  end if;

  v_invitee_email := lower(btrim(p_invitee_email));

  if v_invitee_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invitee email is not a valid email address';
  end if;

  select lower(u.email) into v_inviter_email
  from auth.users u
  where u.id = v_inviter_id;

  if v_inviter_email is not null and v_inviter_email = v_invitee_email then
    raise exception 'cannot invite yourself';
  end if;

  if public.event_occurrence_is_effectively_canceled(p_occurrence_id) then
    raise exception
      'this occurrence is effectively canceled: a new invitation cannot be created'
      using errcode = '90002';
  end if;

  if not exists (
    select 1
    from public.occurrence_participations inviter_participation
    where inviter_participation.occurrence_id = p_occurrence_id
      and inviter_participation.user_id = v_inviter_id
      and inviter_participation.status = 'attending'::public.participation_status
  ) then
    raise exception 'only a user attending this occurrence can invite others to it';
  end if;

  select u.id into v_invitee_id
  from auth.users u
  where lower(u.email) = v_invitee_email
    and u.deleted_at is null
  limit 1;

  if v_invitee_id is null then
    return;
  end if;

  if v_invitee_id = v_inviter_id then
    raise exception 'cannot invite yourself';
  end if;

  select existing.id into v_existing_invitation_id
  from public.occurrence_invitations existing
  where existing.occurrence_id = p_occurrence_id
    and existing.inviter_id = v_inviter_id
    and existing.invitee_id = v_invitee_id;
  if found then
    return;
  end if;

  for v_attempt in 1..3 loop
    select invitee_participation.status into v_invitee_status
    from public.occurrence_participations invitee_participation
    where invitee_participation.occurrence_id = p_occurrence_id
      and invitee_participation.user_id = v_invitee_id
    for update;

    if found then
      if v_invitee_status = 'attending'::public.participation_status then
        return;
      end if;
      v_settled := true;
    else
      begin
        insert into public.occurrence_participations (occurrence_id, user_id, status)
        values (p_occurrence_id, v_invitee_id, 'considering'::public.participation_status);
        v_settled := true;
      exception when unique_violation then
        v_settled := false;
      end;
    end if;

    exit when v_settled;
  end loop;

  if not v_settled then
    raise warning 'invite_to_occurrence_by_email: could not settle invitee participation state (occurrence=%, inviter=%)',
      p_occurrence_id, v_inviter_id;
    return;
  end if;

  insert into public.occurrence_invitations (occurrence_id, inviter_id, invitee_id)
  values (p_occurrence_id, v_inviter_id, v_invitee_id)
  on conflict (occurrence_id, inviter_id, invitee_id) do nothing;

  if not found then
    if not exists (
      select 1
      from public.occurrence_invitations existing
      where existing.occurrence_id = p_occurrence_id
        and existing.inviter_id = v_inviter_id
        and existing.invitee_id = v_invitee_id
    ) then
      raise warning 'invite_to_occurrence_by_email: invitation could not be created or resolved (occurrence=%, inviter=%)',
        p_occurrence_id, v_inviter_id;
      return;
    end if;
  end if;
end;
$$;

revoke execute on function public.invite_to_occurrence_by_email(uuid, text) from public;
grant execute on function public.invite_to_occurrence_by_email(uuid, text) to authenticated;
