-- A8: share_schedule_entry_by_email が業務上の拒否理由を custom SQLSTATE で
-- 表すことを固定する（`docs/v2/decisions.md`）。
--
-- 以前は SQLSTATE を持たず、呼び出し側がメッセージ本文の完全一致で意味を
-- 復元していた。この結合は migration の文言を変えた瞬間に静かに壊れる。
--
-- **メッセージ本文もあわせて確認する。** app 側は移行期間中まだ文字列一致で
-- 動いており、本文を変えると壊れるため。文字列一致を撤去する PR で、この
-- 本文の assertion も外す。
\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

select pg_temp.create_test_user() as owner_id \gset
select pg_temp.create_test_user() as other_id \gset

insert into personal_schedule_entries (owner_id, title, is_all_day, starts_on, ends_on, blocking)
values (:'owner_id', 'A8 test entry', true, '2026-05-10', '2026-05-10', true)
returning id as entry_id \gset

-- email は role 切替の**前**に取得する。authenticated からは auth.users を
-- 読めない（permission denied）ため、テスト本体で参照すると本題と無関係な
-- 理由で落ちる。
select email as owner_email from auth.users where id = :'owner_id' \gset
select email as other_email from auth.users where id = :'other_id' \gset

call pg_temp.auth_as_user(:'owner_id');

-- 未登録アドレス -> 90010
select throws_ok(
  format('select share_schedule_entry_by_email(%L, %L)', :'entry_id', 'nobody-a8@example.test'),
  '90010',
  'recipient email is not a registered account',
  'unregistered recipient raises SQLSTATE 90010'
);

-- 自分自身 -> 90011
select throws_ok(
  format('select share_schedule_entry_by_email(%L, %L)', :'entry_id', :'owner_email'),
  '90011',
  'cannot share with yourself',
  'self-share raises SQLSTATE 90011'
);

-- 正常系は従来どおり成立する（SQLSTATE の追加が既存の成功経路を壊していない）
select lives_ok(
  format('select share_schedule_entry_by_email(%L, %L)', :'entry_id', :'other_email'),
  'sharing with a registered recipient still succeeds'
);

select is(
  (select count(*)::int from personal_schedule_shares
    where schedule_entry_id = :'entry_id' and shared_with_user_id = :'other_id'),
  1,
  'the share row was created'
);

select * from finish();
rollback;
