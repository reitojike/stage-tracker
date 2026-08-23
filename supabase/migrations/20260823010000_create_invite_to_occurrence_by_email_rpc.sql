-- Email-based invitee targeting for occurrence invitations (Issue #55).
--
-- Product decision (Issue #55): MVP authenticated-user targeting for #36
-- invitation is the invitee's exact registered email address, never a raw
-- internal user id from a client. public.invite_to_occurrence(uuid, uuid)
-- (20260822010200_create_invite_to_occurrence_rpc.sql, Issue #33) remains in
-- place as the id-based typed-boundary primitive, but the invite UI calls
-- this function instead.
--
-- This function resolves p_invitee_email to a user id against auth.users -
-- reachable here only because SECURITY DEFINER executes as the function
-- owner, which has table access the authenticated role does not (see the
-- revoke/grant at the bottom) - and then performs the same
-- product-rules.md three-branch dispatch invite_to_occurrence(uuid, uuid)
-- does. It is not a thin wrapper around that function: opacity. Issue #55
-- requires that a syntactically valid email input never let the caller
-- distinguish "no such account", "account exists but was never invited",
-- "account exists, already invited, invitee still considering", "already
-- attending" (invite_to_occurrence(uuid, uuid) already collapses this one
-- to a void return), or "already invited and declined"
-- (invite_to_occurrence(uuid, uuid) deliberately raises a distinct
-- exception for this last one - see its header). That last case is exactly
-- the one this function cannot reuse as-is: raising there would tell an
-- inviter who only has an email address that the address belongs to a
-- real, previously-invited account - strictly more than
-- invite_to_occurrence(uuid, uuid) reveals to an inviter who already had
-- the id. So every invitee-dependent branch here - not found, no row,
-- considering, attending, and previously declined - returns the same void.
--
-- What remains distinguishable is only ever a fact about the caller: not
-- authenticated, missing/malformed input, inviting their own address, or
-- not attending this occurrence. None of those are a function of the
-- invitee, so none of them reopen the occurrence_invitations_select_invitee
-- side channel the opaque return value closes.
--
-- This includes the two backstops past the point v_invitee_id has already
-- resolved to a real account (the settle-loop retry-exhaustion check and
-- the post-insert not-found recheck below): both are reachable *only* when
-- an invitee account exists, so an exception there - even one meant only
-- to signal "this should never happen" - would itself be an
-- account-existence oracle: an inviter could tell "no such account" apart
-- from "account exists" purely from whether the call raised at all, with
-- no need to ever see the void/non-void distinction the rest of this
-- function is built around. Both backstops therefore return the same void
-- as every other invitee-dependent branch, and log via `raise warning`
-- (visible in server logs for operators, never surfaced to the client)
-- instead of `raise exception`, so genuine contention is still observable
-- without reopening the oracle.
--
-- Concurrency/settle-loop shape mirrors invite_to_occurrence(uuid, uuid)
-- exactly (see that function's header). Duplicated here rather than
-- factored into a shared helper because the two functions' opacity
-- boundaries differ at exactly the "declined" branch, and a shared helper
-- would either have to leak that distinction back out or hide it from the
-- id-based function's already-approved behavior.
create function public.invite_to_occurrence_by_email(
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
  -- Defense-in-depth: EXECUTE is restricted to authenticated below (never
  -- PUBLIC/anon), so this should be unreachable in practice.
  if v_inviter_id is null then
    raise exception 'authentication required';
  end if;

  if p_occurrence_id is null or p_invitee_email is null or btrim(p_invitee_email) = '' then
    raise exception 'occurrence and invitee email are required';
  end if;

  v_invitee_email := lower(btrim(p_invitee_email));

  -- A format sanity check, not a full RFC 5322 validator, and never a
  -- function of account existence - this rejects "not even shaped like an
  -- email" before any auth.users lookup happens.
  if v_invitee_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invitee email is not a valid email address';
  end if;

  select lower(u.email) into v_inviter_email
  from auth.users u
  where u.id = v_inviter_id;

  -- Also enforced by occurrence_invitations_not_self once an invitee id is
  -- resolved below, but checked here so a self-invite is reported the same
  -- way regardless of whether resolution would even find an account - and
  -- so it never falls into this function's "invitee not found" no-op,
  -- which would otherwise let a caller confirm their own email resolves.
  if v_inviter_email is not null and v_inviter_email = v_invitee_email then
    raise exception 'cannot invite yourself';
  end if;

  -- Eligibility is strictly "attending this occurrence" - see
  -- invite_to_occurrence(uuid, uuid) for why event ownership is not
  -- consulted. A non-existent occurrence fails here too, with the same
  -- message.
  if not exists (
    select 1
    from public.occurrence_participations inviter_participation
    where inviter_participation.occurrence_id = p_occurrence_id
      and inviter_participation.user_id = v_inviter_id
      and inviter_participation.status = 'attending'::public.participation_status
  ) then
    raise exception 'only a user attending this occurrence can invite others to it';
  end if;

  -- Resolution happens only after every caller-fact check above has
  -- passed, so a failed resolution (no matching, non-deleted account)
  -- reaches the same "return void" as every other invitee-dependent
  -- outcome below - there is no separate code path for "not found".
  select u.id into v_invitee_id
  from auth.users u
  where lower(u.email) = v_invitee_email
    and u.deleted_at is null
  limit 1;

  if v_invitee_id is null then
    return;
  end if;

  -- Backstop, independent of the email-based check above: that check is
  -- skipped when the inviter has no email on file (v_inviter_email is
  -- null - e.g. phone/OAuth auth with no email), which would otherwise let
  -- such a caller "invite" an address that resolves back to their own
  -- account. Comparing resolved ids rather than emails covers that gap and
  -- needs no email at all. Raising here is safe (not an oracle): it fires
  -- only when the invitee *is* the caller, a fact the caller already knows
  -- - it reveals nothing about any third party's account.
  if v_invitee_id = v_inviter_id then
    raise exception 'cannot invite yourself';
  end if;

  select existing.id into v_existing_invitation_id
  from public.occurrence_invitations existing
  where existing.occurrence_id = p_occurrence_id
    and existing.inviter_id = v_inviter_id
    and existing.invitee_id = v_invitee_id;
  if found then
    -- Both "the same invite repeated" and "previously declined" resolve to
    -- the same void return here - unlike invite_to_occurrence(uuid, uuid),
    -- which raises a distinct exception for the declined case (see this
    -- function's header for why that would leak account existence here).
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
        -- Out of scope for invite: write no invitation row, leave the
        -- `attending` participation exactly as it is, same as
        -- invite_to_occurrence(uuid, uuid).
        return;
      end if;
      -- `considering`: keep it exactly as it is.
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
    -- Opaque backstop - see this function's header for why this cannot
    -- `raise exception` (v_invitee_id is already a resolved, existing
    -- account by this point). Logged server-side only.
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
      -- Opaque backstop - see this function's header for why this cannot
      -- `raise exception` either.
      raise warning 'invite_to_occurrence_by_email: invitation could not be created or resolved (occurrence=%, inviter=%)',
        p_occurrence_id, v_inviter_id;
      return;
    end if;
  end if;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default on function creation; every
-- role (including anon) is implicitly a member of PUBLIC, so this must be
-- revoked explicitly before granting only to authenticated.
revoke execute on function public.invite_to_occurrence_by_email(uuid, text) from public;
grant execute on function public.invite_to_occurrence_by_email(uuid, text) to authenticated;
