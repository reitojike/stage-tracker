-- Sole supported decline path (Issue #30).
--
-- product-rules.md requires that an invitee who turns an invitation down be
-- recorded on the invitation lifecycle rather than as a `not_attending`
-- participation. It does not define un-declining, and it explicitly leaves
-- invitation history retention mechanics to be settled by real need.
--
-- A one-column UPDATE grant on declined_at could express "the invitee may
-- write this column", but not "the invitee may record a decline": the same
-- grant would let them write an arbitrary timestamp, and set the column back
-- to null. That second capability is decline-undo - an operation no product
-- rule has approved - so occurrence_invitations carries no UPDATE grant and
-- no UPDATE policy at all, and this function is the only way declined_at
-- ever changes.
--
-- Consequently the value is system-managed, exactly like created_at /
-- updated_at: there is no timestamp parameter here, and the only value ever
-- written is now().
create function public.decline_occurrence_invitation(
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
  -- Defense-in-depth: EXECUTE is restricted to authenticated below, so this
  -- should be unreachable, but a null actor must never match a row.
  if v_actor_id is null then
    raise exception 'authentication required';
  end if;

  if p_invitation_id is null then
    raise exception 'invitation is required';
  end if;

  -- SECURITY DEFINER means the policies on occurrence_invitations are not
  -- consulted here, so the invitee restriction is part of this predicate,
  -- not a policy that happens to also apply: an inviter (or any third party)
  -- calling this matches no row. FOR UPDATE serialises two concurrent
  -- declines of the same invitation, so the second one observes the first
  -- one's declined_at rather than overwriting it.
  select existing.* into v_invitation
  from public.occurrence_invitations existing
  where existing.id = p_invitation_id
    and existing.invitee_id = v_actor_id
  for update;

  -- Deliberately the same message whether the invitation does not exist or
  -- belongs to somebody else: an invitation is readable only by its two
  -- parties, and this must not become a probe for whether a given id exists.
  if not found then
    raise exception 'invitation not found';
  end if;

  -- Already declined: return it unchanged rather than re-stamping. Declining
  -- twice is the same act repeated, so this is idempotent for the same
  -- reason the invite short-circuit is - and not re-stamping keeps
  -- declined_at meaning "when they declined".
  if v_invitation.declined_at is not null then
    return v_invitation;
  end if;

  -- Only declined_at is written. The invitee's participation is untouched:
  -- product-rules.md rules out mirroring a decline as a participation status,
  -- and withdrawing a participation is a separate act the invitee performs
  -- on their own row (occurrence_participations_delete_own).
  update public.occurrence_invitations
  set declined_at = now()
  where id = v_invitation.id
  returning * into v_invitation;

  return v_invitation;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default on function creation; every
-- role (including anon) is implicitly a member of PUBLIC, so this must be
-- revoked explicitly before granting only to authenticated.
revoke execute on function public.decline_occurrence_invitation(uuid) from public;
grant execute on function public.decline_occurrence_invitation(uuid) to authenticated;
