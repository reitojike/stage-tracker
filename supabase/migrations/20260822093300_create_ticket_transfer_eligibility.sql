-- Transfer recipient eligibility (Issue #32) - the single integration seam
-- with Issue #30 (participation / invitation persistence).
--
-- product-rules.md, "Ticket transfer": "transfer 先は、同じ occurrence へ
-- invitation された registered user を MVP の eligibility とします。"
--
-- That predicate can only be evaluated against invitation persistence, which
-- Issue #30 establishes and which is not on main at the time this migration
-- is written. Rather than guess at #30's table or column shape - or, worse,
-- stand up a second invitation mechanism inside this slice - the check is
-- isolated in this one function. Wiring it to the real contract is a
-- replacement of this body and nothing else; no caller, policy, grant or
-- test structure changes.
--
-- ==> INTERIM STATE: this body fails closed. <==
--
-- Returning false means request_ticket_transfer refuses every request. The
-- alternative - returning true until #30 lands - would ship a transfer path
-- open to any registered user, which is exactly the silent widening this
-- eligibility rule exists to prevent. Issue #32 is NOT merge-ready while
-- this placeholder is still in place: the accompanying Issue/PR evidence
-- records it as an explicit blocker, and the eligibility positive/negative
-- tests land together with the real body.
--
-- p_occurrence_id is already threaded through from the caller (resolved
-- from the ticket's source acquisition) so that the real body has the
-- occurrence scope the rule requires without touching request_ticket_transfer.
create function public.ticket_transfer_recipient_is_eligible(
  p_occurrence_id uuid,
  p_recipient_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Referencing both arguments keeps the signature honest about what the
  -- real predicate is scoped to while the body is a placeholder.
  if p_occurrence_id is null or p_recipient_id is null then
    return false;
  end if;

  return false;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default on function creation; every
-- role (including anon) is implicitly a member of PUBLIC, so this must be
-- revoked explicitly before granting only to authenticated.
revoke execute on function public.ticket_transfer_recipient_is_eligible(uuid, uuid)
  from public;
grant execute on function public.ticket_transfer_recipient_is_eligible(uuid, uuid)
  to authenticated;
