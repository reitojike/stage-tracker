-- oracle: docs/v2/oracle-database.md §2 "occurrence_participations" and §6
-- "Participation" (本人のみが自分のparticipationを書ける、event owner
-- でさえ他人のprivate participationを読めない、default visibility=private).
\ir helpers/auth.psql

begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

select pg_temp.create_test_user() as owner_id \gset
select pg_temp.create_test_user() as attendee_id \gset
select pg_temp.create_test_user() as bystander_id \gset

insert into events (owner_id, title, starts_on, ends_on)
values (:'owner_id', 'participation fixture', '2026-09-01', '2026-09-01')
returning id as event_id \gset

insert into event_occurrences (event_id, starts_at)
values (:'event_id', '2026-09-01T18:00:00+09:00')
returning id as occurrence_id \gset

-- A user can create their own participation (default visibility=private).
call pg_temp.auth_as_user(:'attendee_id');
insert into occurrence_participations (occurrence_id, user_id, status)
values (:'occurrence_id', :'attendee_id', 'considering')
returning id as participation_id \gset

select is(
  (select visibility::text from occurrence_participations where id = :'participation_id'),
  'private',
  'default participation visibility is private'
);

-- A user cannot create a participation on someone else's behalf.
call pg_temp.auth_as_user(:'bystander_id');
select throws_ok(
  format(
    $$ insert into occurrence_participations (occurrence_id, user_id, status) values (%L, %L, 'considering') $$,
    :'occurrence_id', :'attendee_id'
  ),
  '42501',
  null,
  'a user cannot create a participation row for another user'
);

-- Another authenticated user cannot read a private participation - not
-- even the event owner.
select is(
  (select count(*) from occurrence_participations where id = :'participation_id'),
  0::bigint,
  'a bystander cannot read another user''s private participation'
);

call pg_temp.auth_as_user(:'owner_id');
select is(
  (select count(*) from occurrence_participations where id = :'participation_id'),
  0::bigint,
  'the event owner cannot read another user''s private participation either'
);

-- The owning user flips visibility to public.
call pg_temp.auth_as_user(:'attendee_id');
with updated as (
  update occurrence_participations set visibility = 'public' where id = :'participation_id'
  returning id
)
select is((select count(*) from updated), 1::bigint,
  'the participation''s own user can change its visibility to public');

-- Now any authenticated user can read it.
call pg_temp.auth_as_user(:'bystander_id');
select is(
  (select count(*) from occurrence_participations where id = :'participation_id'),
  1::bigint,
  'a public participation is readable by any authenticated user'
);

-- A bystander cannot update someone else's participation, public or not.
with updated as (
  update occurrence_participations set status = 'attending' where id = :'participation_id'
  returning id
)
select is((select count(*) from updated), 0::bigint,
  'a bystander''s update of another user''s participation matches no rows');

call pg_temp.auth_as_admin();
select is(
  (select status::text from occurrence_participations where id = :'participation_id'),
  'considering',
  'the participation''s status is unchanged by the bystander''s no-op update'
);

select * from finish();
rollback;
