-- Notifications M2 (Issue #511): materialize an invitation notification only
-- when a new pending Invitation row is actually inserted.
--
-- The occurrence_invitations INSERT is the canonical materialization fact for
-- both supported invitation RPCs. Keeping generation at this source-local
-- boundary means duplicate `on conflict do nothing` writes do not fire this
-- AFTER INSERT trigger, and the source row plus Notification share one
-- PostgreSQL transaction. No RPC response or Invitation privacy branch is
-- changed here.

create function public.create_invitation_received_notification() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (recipient_id, kind, source_id)
  values (
    new.invitee_id,
    'invitation_received'::public.notification_kind,
    new.id
  )
  on conflict (recipient_id, kind, source_id) do nothing;

  return new;
end;
$$;

-- The function is only an implementation detail of the source trigger. No
-- client role needs to call it, and granting EXECUTE would create an
-- unnecessary Notification-generation surface.
revoke execute on function public.create_invitation_received_notification() from public;

create trigger occurrence_invitations_create_notification
  after insert on public.occurrence_invitations
  for each row
  execute function public.create_invitation_received_notification();
