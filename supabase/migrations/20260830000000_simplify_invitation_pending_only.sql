-- Invitation simplification: pending-only coordination (Issue #225 Part A,
-- Issue #230 PR A).
--
-- Product semantics change from Issue #30/#36's original design (see
-- 20260822010000_create_occurrence_participations.sql,
-- 20260822010100_create_occurrence_invitations.sql,
-- 20260822010200_create_invite_to_occurrence_rpc.sql,
-- 20260822010300_create_decline_occurrence_invitation_rpc.sql,
-- 20260823010000_create_invite_to_occurrence_by_email_rpc.sql,
-- 20260826000200_create_event_occurrence_cancellation.sql for the versions
-- this migration supersedes via CREATE OR REPLACE):
--
-- 1. Inviting an invitee with no participation row no longer creates a
--    `considering` participation as a side effect. An invitation now records
--    *only* the pending coordination fact - it never writes the invitee's
--    participation.
-- 2. An invitee's participation reaching `attending` - by any path (accepting
--    an invitation, or the ordinary Event/Occurrence participation UI) -
--    resolves (deletes) every pending invitation for that (occurrence,
--    invitee) pair, regardless of how many different inviters sent one. This
--    is the new `occurrence_participations_resolve_invitations_on_attending`
--    trigger below; it is also what "accepting an invitation" *is* now -
--    there is no separate accept RPC, because accepting an invitation is
--    exactly "set my participation to attending", the same operation the
--    generic participation UI already performs (Issue #225: "resulting
--    Participation is indistinguishable from self-created attending").
-- 3. Declining an invitation now DELETEs the row instead of stamping
--    declined_at. "Resolved" is uniformly represented as row absence - there
--    is no durable decline history, matching Issue #225/#230's explicit "no
--    accepted-history requirement" and the addendum's "resolved rows are not
--    shown as history" UI requirement. declined_at is left in place as an
--    unused column (this PR does not drop schema - see #230 "legacy Ticket
--    runtime separation" for the parallel constraint on Ticket tables); no
--    future write ever sets it again.
-- 4. A prior decline no longer permanently blocks re-invitation: since
--    decline now deletes the row, a later invite_to_occurrence(_by_email)
--    call for the same (occurrence, inviter, invitee) simply finds no
--    existing row and creates a fresh pending one - the old "this invitation
--    was declined; re-inviting is not a supported operation" exception is
--    removed.
--
-- What is unchanged: inviter eligibility (must be `attending`), the
-- attending-invitee branch (no invitation is created - this was already the
-- pending-only shape for that branch), the considering-invitee branch (an
-- invitation is created, the existing `considering` participation is left
-- alone), invite opacity (every branch returns the same void), and the
-- cancellation guard on new invitations.
--
-- Data backfill: existing rows are brought in line with the new pending-only
-- model in the same migration (not a separate cleanup task) - a declared
-- `declined_at` row, or a row whose invitee is already `attending` that
-- (predating this migration's resolve-on-attending trigger) was never
-- cleaned up, is no longer a "pending invitation" under the new semantics and
-- must not resurface as one just because the UI stopped filtering by
-- declined_at. This is a row-level data correction consistent with the new
-- semantics, not a destructive schema change - the legacy Ticket
-- acquisition/inventory/transfer tables this PR explicitly defers dropping
-- are untouched.
delete from public.occurrence_invitations existing
where existing.declined_at is not null
   or exists (
     select 1
     from public.occurrence_participations p
     where p.occurrence_id = existing.occurrence_id
       and p.user_id = existing.invitee_id
       and p.status = 'attending'::public.participation_status
   );

-- Resolves (deletes) every pending invitation addressed to NEW.user_id for
-- NEW.occurrence_id whenever that participation reaches `attending` - covers
-- both "accept an invitation" (which is now just this) and "generic attending
-- convergence" (Issue #225/#230: the ordinary participation UI must also
-- converge pending invitations) through the single write path every
-- attending transition already goes through, rather than two separate
-- mechanisms that could drift apart.
--
-- SECURITY DEFINER: occurrence_invitations carries no DELETE grant/policy for
-- authenticated (20260822010100_create_occurrence_invitations.sql) - by
-- design, invitation writes only ever happen through this project's own
-- SECURITY DEFINER functions/triggers, never a direct client grant. Running
-- as invoker would make this delete a no-op for every caller.
--
-- pg_advisory_xact_lock, keyed by (occurrence_id, user_id), closes a race
-- against invite_to_occurrence(_by_email): that RPC's own "is the invitee
-- already attending" check has nothing to lock against for a *rowless*
-- invitee (no existing occurrence_participations row = no row for `for
-- share` to hold), so without this, a concurrent first-ever attending INSERT
-- and a concurrent invite could interleave as: invite checks (no row, not
-- attending) -> attending INSERT commits (this trigger runs, finds nothing
-- to delete yet) -> invite's own INSERT lands afterward, leaving a pending
-- invitation for an invitee who is already attending. Acquiring the same
-- lock key here and in invite_to_occurrence(_by_email) below serializes the
-- two paths against each other regardless of row existence, so whichever
-- transaction commits first is always the one the other observes.
create function public.resolve_pending_invitations_on_attending() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.occurrence_id::text), hashtext(new.user_id::text));
  delete from public.occurrence_invitations
  where occurrence_id = new.occurrence_id
    and invitee_id = new.user_id;
  return new;
end;
$$;

-- Split into two triggers (Postgres rejects `OLD` in a combined INSERT-OR-
-- UPDATE trigger's WHEN clause with "INSERT trigger's WHEN condition cannot
-- reference OLD values", SQLSTATE 42P17): every INSERT is by definition a
-- transition into whatever status it sets, so the INSERT trigger only needs
-- `new.status = 'attending'`; the UPDATE trigger additionally requires
-- `old.status is distinct from new.status` to scope it to genuine
-- transitions *into* attending, not every subsequent no-op write (e.g. a
-- visibility-only toggle) that merely leaves status at attending - such a
-- write still satisfies a bare `new.status = 'attending'` check, which would
-- otherwise re-acquire the advisory lock and re-scan for nothing to delete
-- on every unrelated update.
create trigger occurrence_participations_resolve_invitations_on_attending_ins
  after insert on public.occurrence_participations
  for each row
  when (new.status = 'attending'::public.participation_status)
  execute function public.resolve_pending_invitations_on_attending();

create trigger occurrence_participations_resolve_invitations_on_attending_upd
  after update on public.occurrence_participations
  for each row
  when (
    new.status = 'attending'::public.participation_status
    and old.status is distinct from new.status
  )
  execute function public.resolve_pending_invitations_on_attending();

-- decline_occurrence_invitation: DELETE instead of stamp declined_at (see
-- point 3 above). Idempotent by returning null rather than raising when no
-- matching row is found - a second decline call for the same invitation (the
-- UI's own finalize-on-timer-or-unmount path can legitimately fire twice
-- under a race, see InvitationCard.tsx) is a no-op, not an error, the same
-- idempotence contract the original declined_at-stamping version had for a
-- repeat call.
create or replace function public.decline_occurrence_invitation(
  p_invitation_id uuid
) returns public.occurrence_invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_invitation public.occurrence_invitations;
begin
  if v_actor_id is null then
    raise exception 'authentication required';
  end if;

  if p_invitation_id is null then
    raise exception 'invitation is required';
  end if;

  delete from public.occurrence_invitations
  where id = p_invitation_id
    and invitee_id = v_actor_id
  returning * into v_invitation;

  if not found then
    return null;
  end if;

  return v_invitation;
end;
$$;

revoke execute on function public.decline_occurrence_invitation(uuid) from public;
grant execute on function public.decline_occurrence_invitation(uuid) to authenticated;

-- invite_to_occurrence: no more "insert a considering participation for a
-- rowless invitee" step, and no more "raise on re-invite after decline"
-- branch (declined rows no longer persist to raise about). The
-- attending-invitee short-circuit now runs under the same
-- pg_advisory_xact_lock key (occurrence_id, invitee_id) the
-- resolve-on-attending trigger acquires above, rather than a `for share`
-- lock on the invitee's own participation row - that would still be
-- unlocked (and unlockable) for a rowless invitee, which is exactly the gap
-- the advisory lock is what actually closes (see this migration's header,
-- point 2, and the trigger's own comment above).
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
  v_invitee_status public.participation_status;
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

  -- Already invited and still pending: idempotent no-op, same as before.
  if exists (
    select 1
    from public.occurrence_invitations existing
    where existing.occurrence_id = p_occurrence_id
      and existing.inviter_id = v_inviter_id
      and existing.invitee_id = p_invitee_id
  ) then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_occurrence_id::text), hashtext(p_invitee_id::text));

  select invitee_participation.status into v_invitee_status
  from public.occurrence_participations invitee_participation
  where invitee_participation.occurrence_id = p_occurrence_id
    and invitee_participation.user_id = p_invitee_id;

  if found and v_invitee_status = 'attending'::public.participation_status then
    return;
  end if;

  insert into public.occurrence_invitations (occurrence_id, inviter_id, invitee_id)
  values (p_occurrence_id, v_inviter_id, p_invitee_id)
  on conflict (occurrence_id, inviter_id, invitee_id) do nothing;
end;
$$;

revoke execute on function public.invite_to_occurrence(uuid, uuid) from public;
grant execute on function public.invite_to_occurrence(uuid, uuid) to authenticated;

-- invite_to_occurrence_by_email: same shape of change as invite_to_occurrence
-- above, mirrored for the email-resolution path. Opacity is unaffected -
-- every invitee-dependent branch (no such account, no participation row,
-- considering, attending, already invited) still returns the same void.
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
  v_invitee_status public.participation_status;
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

  if exists (
    select 1
    from public.occurrence_invitations existing
    where existing.occurrence_id = p_occurrence_id
      and existing.inviter_id = v_inviter_id
      and existing.invitee_id = v_invitee_id
  ) then
    return;
  end if;

  -- Same lock key (occurrence_id, invitee_id) as invite_to_occurrence and
  -- the resolve-on-attending trigger - see their comments above for why a
  -- `for share` row lock cannot close this race for a rowless invitee.
  perform pg_advisory_xact_lock(hashtext(p_occurrence_id::text), hashtext(v_invitee_id::text));

  select invitee_participation.status into v_invitee_status
  from public.occurrence_participations invitee_participation
  where invitee_participation.occurrence_id = p_occurrence_id
    and invitee_participation.user_id = v_invitee_id;

  if found and v_invitee_status = 'attending'::public.participation_status then
    return;
  end if;

  insert into public.occurrence_invitations (occurrence_id, inviter_id, invitee_id)
  values (p_occurrence_id, v_inviter_id, v_invitee_id)
  on conflict (occurrence_id, inviter_id, invitee_id) do nothing;
end;
$$;

revoke execute on function public.invite_to_occurrence_by_email(uuid, text) from public;
grant execute on function public.invite_to_occurrence_by_email(uuid, text) to authenticated;
