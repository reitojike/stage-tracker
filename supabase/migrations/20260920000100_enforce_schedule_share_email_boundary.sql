-- Enforce the exact-email RPC as the only authenticated share-creation path.
--
-- `share_schedule_entry_by_email` is already the first-party application's
-- supported create path. Keeping a direct authenticated INSERT grant and its
-- owner policy would also let a caller target a raw user UUID (including its
-- own UUID), bypassing that boundary. SELECT and DELETE remain the supported
-- read/revoke and self-leave paths.

begin;

-- Re-state the complete intended authenticated grant set so any table- or
-- column-level INSERT grant is removed, including the column grant created by
-- the original personal-schedule migration.
revoke all on public.personal_schedule_shares from authenticated;
revoke insert (schedule_entry_id, shared_with_user_id)
  on public.personal_schedule_shares
  from authenticated;
grant select, delete on public.personal_schedule_shares to authenticated;

-- With no authenticated INSERT privilege, this policy is unreachable and must
-- not remain as a latent raw-UUID create path if a grant is accidentally
-- reintroduced later.
drop policy personal_schedule_shares_insert_owner on public.personal_schedule_shares;

commit;
