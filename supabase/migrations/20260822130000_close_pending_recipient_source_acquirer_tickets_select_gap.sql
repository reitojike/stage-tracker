-- Close a pending-transfer assignment disclosure gap reachable through the
-- source-acquirer read path (Issue #50).
--
-- tickets_select_owner_or_source_acquirer (20260822093100_create_tickets.sql)
-- grants full-row SELECT to the current owner, or to the owner of the
-- ticket's source acquisition, with no regard to whether a transfer is
-- currently pending. That is fine on its own: product-rules.md's pending-
-- recipient non-disclosure was implemented as a *withheld policy* on
-- public.tickets plus the pending_ticket_transfer_offer projection
-- (20260822093200_create_ticket_transfers.sql), not as a condition on this
-- policy.
--
-- The two combine badly in one case the original slice did not consider: a
-- ticket can be transferred back to its own source acquirer. When that
-- happens, the pending recipient and the source acquirer are the same
-- person, and the source-acquirer branch below has always granted them
-- full-row access - including assigned_to_user_id and
-- assignee_external_name, i.e. exactly what the pending-recipient
-- non-disclosure exists to withhold until they accept.
--
-- The fix mirrors how every other pending recipient is already treated:
-- while a transfer is pending *to* them, this caller gets no full-row
-- access to this ticket at all, source-acquirer status notwithstanding.
-- They still have pending_ticket_transfer_offer for the accept/decline
-- surface, and their own SELECT on ticket_transfers already shows them the
-- full transfer chain, unaffected by this change - can_view_ticket_provenance
-- reads tickets/ticket_acquisitions directly under SECURITY DEFINER, not
-- through this policy. So provenance ("does this ticket exist, who has it
-- been transferred to/from") stays observable; only the redundant full-row
-- path that leaked assignment during the pending window is closed.
--
-- Once accepted (or the offer is cancelled), the exclusion lifts on its own:
-- there is no pending row left for the condition to match, and if they
-- became the owner they read via the owner_id branch instead.
drop policy tickets_select_owner_or_source_acquirer on public.tickets;

create policy tickets_select_owner_or_source_acquirer
  on public.tickets
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    or (
      exists (
        select 1
        from public.ticket_acquisitions a
        where a.id = acquisition_id
          and a.owner_id = auth.uid()
      )
      and not exists (
        -- Must be tickets.id, not the bare "id": ticket_transfers also has
        -- an id column, so an unqualified "id" here would resolve to the
        -- subquery's own tr.id and this exclusion would silently never
        -- match.
        select 1
        from public.ticket_transfers tr
        where tr.ticket_id = tickets.id
          and tr.status = 'pending'
          and tr.recipient_id = auth.uid()
      )
    )
  );
