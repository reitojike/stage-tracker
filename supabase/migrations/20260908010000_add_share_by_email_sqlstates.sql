-- A8 の技術的負債の解消（`docs/v2/decisions.md`）。
--
-- `share_schedule_entry_by_email` は業務上の拒否理由を **メッセージ本文だけ**
-- で表現しており、SQLSTATE を持たない。そのため呼び出し側は
-- `error.message === 'recipient email is not a registered account'` という
-- **文字列の完全一致**で意味を復元している
-- (`apps/web/src/lib/actions/schedule/schedule-share-write.ts`)。
--
-- この結合は静かに壊れる。将来このメッセージを 1 文字でも変えると、
-- app 側は「未登録アドレス」を認識できなくなり、汎用の失敗文言へ落ちる。
-- CI は通る。cancellation 系（90001 / 90002）は既に custom SQLSTATE で
-- 構造化済みであり、share 系だけが取り残されていた。
--
-- ## この migration が app code を変更しない理由
--
-- **メッセージ本文は変えない。** 既存の app code は従来どおり文字列一致で
-- 動き続ける。SQLSTATE は「追加」であって置き換えではない。
--
-- したがってこの migration は **deploy 順序に依存しない**（適用前でも適用後
-- でも既存 build が正しく動く）。app 側を SQLSTATE 判定へ切り替えるのは
-- 別 PR で行い、文字列一致の撤去はさらにその後の PR で行う。
-- M4 で採った expand -> migrate -> contract を、エラーコードにも適用する。
--
-- ## SQLSTATE の割り当て
--
-- 既存: 90001 = delete-blocked、90002 = effectively-canceled。
-- どちらも「application-defined condition」を表す 9xxxx の私的利用域。
--
-- 90010 = 対象 email が登録済みアカウントではない
-- 90011 = 自分自身を対象にした
--
-- **90010 を Invitation 側へ流用してはいけない。** Invitation は invitee の
-- 状態を inviter へ漏らさない opacity を持ち、「そのアドレスは未登録である」
-- ことも開示しない（`AGENTS.md` の Invitation / Authenticated-user
-- targeting）。schedule share にその要件が無いのは、対象 email が未登録で
-- あることを owner へ知らせてよいと product rule が明示しているため。
-- **この 2 つを同じコードで表すと、片方の boundary をもう片方へ持ち込む
-- 事故が起きやすくなる。**

create or replace function public.share_schedule_entry_by_email(
  p_schedule_entry_id uuid,
  p_recipient_email text
) returns public.personal_schedule_shares
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_owner_email text;
  v_recipient_email text;
  v_recipient_id uuid;
  v_share public.personal_schedule_shares;
begin
  -- Defense-in-depth: EXECUTE is restricted to authenticated below (never
  -- PUBLIC/anon), so this should be unreachable in practice.
  if v_owner_id is null then
    raise exception 'authentication required';
  end if;

  if p_schedule_entry_id is null or p_recipient_email is null or btrim(p_recipient_email) = '' then
    raise exception 'schedule entry and recipient email are required';
  end if;

  if not public.is_personal_schedule_entry_owner(p_schedule_entry_id) then
    raise exception 'only the schedule entry owner can add a recipient';
  end if;

  v_recipient_email := lower(btrim(p_recipient_email));

  if v_recipient_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'recipient email is not a valid email address';
  end if;

  select lower(u.email) into v_owner_email
  from auth.users u
  where u.id = v_owner_id;

  if v_owner_email is not null and v_owner_email = v_recipient_email then
    raise exception 'cannot share with yourself' using errcode = '90011';
  end if;

  select u.id into v_recipient_id
  from auth.users u
  where lower(u.email) = v_recipient_email
    and u.deleted_at is null
  limit 1;

  -- No pending/external share for an unregistered email (Issue #55
  -- decision: registered-account-only targeting for #37) - reported
  -- plainly, unlike #36's opaque no-op, for the reason in the original
  -- migration's header.
  --
  -- SQLSTATE 90010 added here (A8). The message text is unchanged so the
  -- currently deployed build, which still matches on it, keeps working.
  if v_recipient_id is null then
    raise exception 'recipient email is not a registered account' using errcode = '90010';
  end if;

  -- Backstop, independent of the email-based check above - see
  -- invite_to_occurrence_by_email's identical backstop for why the
  -- email-based check alone is not enough (v_owner_email can be null), and
  -- for why raising here is safe: it fires only when the recipient *is*
  -- the caller.
  if v_recipient_id = v_owner_id then
    raise exception 'cannot share with yourself' using errcode = '90011';
  end if;

  insert into public.personal_schedule_shares (schedule_entry_id, shared_with_user_id)
  values (p_schedule_entry_id, v_recipient_id)
  on conflict (schedule_entry_id, shared_with_user_id)
  do update set shared_with_user_id = excluded.shared_with_user_id
  returning * into v_share;

  return v_share;
end;
$$;

revoke execute on function public.share_schedule_entry_by_email(uuid, text) from public;
grant execute on function public.share_schedule_entry_by_email(uuid, text) to authenticated;
