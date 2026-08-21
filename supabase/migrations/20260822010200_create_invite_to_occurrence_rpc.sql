-- Sole supported invitation-create path (Issue #30).
--
-- product-rules.md makes an invitation depend on state the caller does not
-- own and, in one branch, on writing a row that belongs to somebody else:
--
--   * the inviter must be `attending` this occurrence (being `considering`,
--     or being the parent event's owner, grants nothing);
--   * invitee has no participation row -> create the invitation AND a
--     `considering` participation for the invitee;
--   * invitee is already `considering` -> create the invitation, leave the
--     participation exactly as it is;
--   * invitee is already `attending` -> out of scope for invite: create no
--     invitation row at all, and leave the `attending` participation intact.
--
-- None of that is expressible as a direct INSERT under RLS - a client
-- cannot insert a participation for another user (by design, see
-- occurrence_participations_insert_own), and a client-side read-then-write
-- could not keep the branch decision and the writes in one transaction.
-- So occurrence_invitations has no INSERT grant and no INSERT policy, and
-- this function is the only way to create one.
--
-- SECURITY DEFINER is what lets this run past those policies: it executes
-- as the function owner (postgres, which has BYPASSRLS), not as the calling
-- authenticated role. That makes the exact set of writes below part of the
-- security boundary, so two invariants are enforced structurally rather
-- than by a check that could be edited away:
--
--   1. There is no UPDATE against public.occurrence_participations
--      anywhere in this function. An invitation therefore cannot demote a
--      confirmed `attending` back to `considering`, and cannot promote
--      anyone to `attending` either - `considering -> attending` stays
--      something only the invitee can do, through the table API as
--      themselves.
--   2. The only participation INSERT hard-codes `considering`. There is no
--      status parameter on this function, so there is no input surface
--      through which an inviter could choose the invitee's status.
--
-- Concurrency: the branch decision above is a check-then-act, so it takes
-- the invitee's participation row under SELECT ... FOR UPDATE before
-- acting. A concurrent `considering -> attending` by the invitee therefore
-- either lands first (and this call raises, leaving `attending` alone) or
-- waits until this call has committed - it can never interleave between the
-- read and the write. When the invitee has no row yet there is nothing to
-- lock, so the (occurrence_id, user_id) unique constraint is the backstop:
-- a losing concurrent INSERT surfaces as unique_violation, and the loop
-- re-reads under lock and re-branches rather than assuming its stale read
-- still holds.
--
-- Only the invitee's row is locked, never the inviter's. Locking both would
-- let two users invite each other concurrently and deadlock, and would buy
-- no invariant: the state this function must not corrupt is the invitee's.
create function public.invite_to_occurrence(
  p_occurrence_id uuid,
  p_invitee_id uuid
) returns public.occurrence_invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inviter_id uuid := auth.uid();
  v_invitation public.occurrence_invitations;
  v_invitee_status public.participation_status;
  v_settled boolean := false;
begin
  -- Defense-in-depth: EXECUTE is restricted to authenticated below (never
  -- PUBLIC/anon), so this should be unreachable in practice, but inviter_id
  -- is derived from auth.uid() and must never be null.
  if v_inviter_id is null then
    raise exception 'authentication required';
  end if;

  if p_occurrence_id is null or p_invitee_id is null then
    raise exception 'occurrence and invitee are required';
  end if;

  -- Also enforced by occurrence_invitations_not_self; checked here so the
  -- caller gets the reason rather than a constraint name.
  if p_invitee_id = v_inviter_id then
    raise exception 'cannot invite yourself';
  end if;

  -- Eligibility is strictly "attending this occurrence". Event ownership is
  -- deliberately not consulted: product-rules.md states that owning the
  -- event confers no invite right. A non-existent occurrence fails here
  -- too, with the same message - this does not confirm whether an
  -- occurrence id exists.
  if not exists (
    select 1
    from public.occurrence_participations inviter_participation
    where inviter_participation.occurrence_id = p_occurrence_id
      and inviter_participation.user_id = v_inviter_id
      and inviter_participation.status = 'attending'::public.participation_status
  ) then
    raise exception 'only a user attending this occurrence can invite others to it';
  end if;

  -- Idempotent short-circuit, before anything is written. Re-inviting
  -- someone this inviter already invited returns the existing row untouched
  -- rather than raising or stacking a duplicate - and, importantly, without
  -- re-running the participation branch below. That is what stops a repeat
  -- invite from re-creating a `considering` row for an invitee who has
  -- already declined and cleared their participation.
  select existing.* into v_invitation
  from public.occurrence_invitations existing
  where existing.occurrence_id = p_occurrence_id
    and existing.inviter_id = v_inviter_id
    and existing.invitee_id = p_invitee_id;
  if found then
    return v_invitation;
  end if;

  -- Bounded rather than unbounded: each retry is caused by a *committed*
  -- competing insert, after which the row exists and the FOR UPDATE branch
  -- takes over, so one retry already suffices. The extra attempts only
  -- absorb a row being deleted again in between, and the loop still fails
  -- loudly instead of spinning.
  for v_attempt in 1..3 loop
    select invitee_participation.status into v_invitee_status
    from public.occurrence_participations invitee_participation
    where invitee_participation.occurrence_id = p_occurrence_id
      and invitee_participation.user_id = p_invitee_id
    for update;

    if found then
      if v_invitee_status = 'attending'::public.participation_status then
        -- Out of scope for invite. Raising (rather than returning quietly)
        -- rolls the whole call back, which is what guarantees no invitation
        -- row survives this branch. It does disclose one bit about the
        -- invitee's otherwise-private participation, but only to a caller
        -- already proven to be attending the same occurrence, and the
        -- product rule that makes this branch "invite 対象外" cannot be
        -- honoured by the caller without it.
        raise exception 'invitee is already attending this occurrence';
      end if;
      -- `considering`: keep it exactly as it is.
      v_settled := true;
    else
      begin
        insert into public.occurrence_participations (occurrence_id, user_id, status)
        values (p_occurrence_id, p_invitee_id, 'considering'::public.participation_status);
        v_settled := true;
      exception when unique_violation then
        -- Someone inserted this participation between our read and our
        -- write. Fall through to another iteration, which re-reads under
        -- lock - the new row may well be `attending`.
        v_settled := false;
      end;
    end if;

    exit when v_settled;
  end loop;

  if not v_settled then
    raise exception 'could not settle invitee participation state for this occurrence';
  end if;

  -- DO NOTHING rather than DO UPDATE: an existing row must never be
  -- rewritten by an invite (that is how declined_at stays the invitee's).
  insert into public.occurrence_invitations (occurrence_id, inviter_id, invitee_id)
  values (p_occurrence_id, v_inviter_id, p_invitee_id)
  on conflict (occurrence_id, inviter_id, invitee_id) do nothing
  returning * into v_invitation;

  if not found then
    -- Reachable only if an identical invitation was committed since the
    -- short-circuit above. Re-read it rather than returning a null record.
    select existing.* into v_invitation
    from public.occurrence_invitations existing
    where existing.occurrence_id = p_occurrence_id
      and existing.inviter_id = v_inviter_id
      and existing.invitee_id = p_invitee_id;
    if not found then
      raise exception 'invitation could not be created or resolved';
    end if;
  end if;

  return v_invitation;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default on function creation; every
-- role (including anon) is implicitly a member of PUBLIC, so this must be
-- revoked explicitly before granting only to authenticated.
revoke execute on function public.invite_to_occurrence(uuid, uuid) from public;
grant execute on function public.invite_to_occurrence(uuid, uuid) to authenticated;
