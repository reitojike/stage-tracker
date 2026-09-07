-- v2 M4 (Issue #375, In Scope #1 / decisions.md P5). Step 1 of the
-- expand/validate/swap pattern, one file per table - see 20260908000000
-- for the full ON DELETE policy rationale and the production lock-safety
-- analysis behind the per-table split and the `lock_timeout` below.
--
-- user_ticket_opportunity_states.user_id -> ON DELETE CASCADE: a personal
-- ticket-planning state row has no meaning once its owning user is gone
-- (the shared ticket_opportunities row it references is untouched), so
-- removing it alongside the user is exactly "消す" per decisions.md P5.
--
-- catalog_creators.user_id already carries ON DELETE CASCADE
-- (20260822000200_create_catalog_creators.sql) and needs no change; it is
-- unchanged by this migration set only because it was already explicit and
-- already correct under this same policy (a creator-permission row is
-- personal, not shared catalog, data). This is the last of the seven FKs
-- from decisions.md P5's list.
--
-- If this statement fails with `55P03 lock not available`: a long-running
-- transaction is currently holding a conflicting lock on
-- public.user_ticket_opportunity_states. No partial state is left behind,
-- so the operator can wait a short while and re-run `supabase db push`;
-- retrying is always safe.
--
-- `post-deploy-safe` per docs/architecture/runtime-stack.md's ordering
-- fence (same reasoning as 20260908000000).
set local lock_timeout = '5s';

alter table public.user_ticket_opportunity_states
  add constraint user_ticket_opportunity_states_user_id_fkey_pending
    foreign key (user_id) references auth.users (id) on delete cascade
    not valid;
