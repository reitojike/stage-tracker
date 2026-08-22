-- Transfer recipient eligibility (Issue #32) - the one place the ticket
-- transfer path depends on Issue #30's invitation persistence.
--
-- product-rules.md, "Ticket transfer": "transfer 先は、同じ occurrence へ
-- invitation された registered user を MVP の eligibility とします。"
--
-- Implemented literally: the recipient is eligible when an invitation row
-- exists for (this occurrence, this recipient). Who sent it does not
-- matter - the rule is about the recipient being an invited participant of
-- the occurrence, not about the ticket owner having been the inviter.
--
-- declined_at is deliberately NOT consulted. "invitation された" is
-- satisfied by a declined invitee too, and narrowing it here would invent a
-- rule product-rules.md does not state. Nothing is forced on the recipient
-- by staying literal: accept_ticket_transfer requires the recipient's own
-- acceptance, so an invitee who declined simply never accepts. See the
-- Issue/PR notes for the PO checkpoint this raises.
--
-- ## Why this is SECURITY DEFINER, and why authenticated gets no EXECUTE
--
-- Issue #30 closed a specific side channel: public.invite_to_occurrence
-- returns void, and occurrence_invitations' SELECT policy is
-- `invitee_id = auth.uid()`, so an inviter cannot tell which of the three
-- invite branches was taken. The branch that writes no invitation row is
-- "the invitee is already attending", which is private participation
-- state.
--
-- This predicate answers "does an invitation row exist for (occurrence,
-- user)". Handing that to callers directly would rebuild exactly the read
-- that #30's SELECT policy withholds, for any (occurrence, user) pair a
-- caller cares to name - a far wider surface than the transfer path
-- itself. So:
--
--   * SECURITY DEFINER, so it can see rows the caller's RLS hides;
--   * EXECUTE revoked from PUBLIC and granted to *no* client role.
--
-- public.request_ticket_transfer is SECURITY DEFINER too, so the call
-- inside it is checked against the definer's privileges, not the caller's.
-- Nothing else calls this, and a normal client cannot reach it at all.
--
-- What remains, and is a product question rather than a mechanism gap: a
-- ticket owner still learns one bit per request_ticket_transfer call, since
-- the call succeeds or raises. That is inherent in enforcing an eligibility
-- rule the caller can trigger. It is recorded as a PO checkpoint on the
-- Issue rather than silently widened or silently narrowed here.
create function public.ticket_transfer_recipient_is_eligible(
  p_occurrence_id uuid,
  p_recipient_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.occurrence_invitations i
    where i.occurrence_id = p_occurrence_id
      and i.invitee_id = p_recipient_id
  );
$$;

-- Postgres grants EXECUTE to PUBLIC by default on function creation; every
-- role (including anon and authenticated) is implicitly a member of PUBLIC,
-- so the default has to be revoked explicitly. No client role is granted
-- EXECUTE back - see the header for why this predicate is definer-only.
revoke execute on function public.ticket_transfer_recipient_is_eligible(uuid, uuid)
  from public;
