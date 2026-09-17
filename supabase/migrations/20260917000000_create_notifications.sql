-- Persisted Notification inbox boundary (Issue #510, child of #231).
--
-- A Notification is an independent surfacing record: it says that a change
-- worth showing to a recipient happened. It is not an Invitation history
-- ledger or a second copy of source-domain state. The first and only MVP kind
-- is invitation_received.
--
-- The source_id for invitation_received points at an occurrence_invitations
-- row, but that row is intentionally an ephemeral soft reference. Invitation
-- resolution deletes the source row, so no FK may make the Notification
-- cascade with it or prevent that deletion. No source snapshot or payload is
-- stored here.

create type public.notification_kind as enum ('invitation_received');

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users (id) on delete cascade,
  kind public.notification_kind not null,
  source_id uuid not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_recipient_kind_source_key
    unique (recipient_id, kind, source_id)
);

-- #231's newest-first ordering is created_at DESC with a deterministic id
-- tie-breaker. Leading with recipient_id keeps the future inbox query scoped
-- to the only rows its caller may see.
create index notifications_recipient_created_at_id_idx
  on public.notifications (recipient_id, created_at desc, id desc);

alter table public.notifications enable row level security;

-- Keep the client boundary exact even when the database's default privileges
-- contain residual grants. The service_role path is the trusted source-
-- mutation boundary used by the later Notification-generation task; the
-- authenticated role receives only the read surface below.
revoke all on public.notifications from public, anon, authenticated;
grant select, insert, update, delete on public.notifications to service_role;
grant select on public.notifications to authenticated;

create policy notifications_select_recipient
  on public.notifications
  for select
  to authenticated
  using (recipient_id = auth.uid());

-- Read state is deliberately not a direct UPDATE grant. This narrow
-- recipient-owned interface can only move an unread row to read, is
-- idempotent for an already-read row, and returns NULL for another user's or
-- a missing row without exposing whether that row exists.
create function public.mark_notification_read(
  p_notification_id uuid
) returns public.notifications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_notification public.notifications;
begin
  if v_actor_id is null then
    raise exception 'authentication required';
  end if;

  if p_notification_id is null then
    raise exception 'notification is required';
  end if;

  update public.notifications
  set read_at = now()
  where id = p_notification_id
    and recipient_id = v_actor_id
    and read_at is null
  returning * into v_notification;

  if found then
    return v_notification;
  end if;

  -- An already-read row is an idempotent no-op. Returning the existing row is
  -- useful to the caller while preserving the no-write behavior above.
  select * into v_notification
  from public.notifications
  where id = p_notification_id
    and recipient_id = v_actor_id;

  if found then
    return v_notification;
  end if;

  return null;
end;
$$;

revoke execute on function public.mark_notification_read(uuid) from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;
