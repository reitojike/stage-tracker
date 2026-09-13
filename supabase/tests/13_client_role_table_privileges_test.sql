-- Client-facing roles must never receive table privileges that bypass or
-- undermine the product-specific CRUD/RLS permission matrix. Keep this test
-- dynamic so every current and future table in the public schema is covered.
-- SELECT / INSERT / UPDATE / DELETE are intentionally outside this guardrail.
begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

select ok(
  to_regrole('anon') is not null,
  'the standard Supabase anon role exists (fail closed on the wrong database)'
);

select ok(
  to_regrole('authenticated') is not null,
  'the standard Supabase authenticated role exists (fail closed on the wrong database)'
);

select results_eq(
  $$
    with required_roles(role_name) as (
      values ('anon'::text), ('authenticated'::text), ('public'::text)
    ),
    target_roles(role_name) as (
      select role_name
      from required_roles
      -- PUBLIC is a PostgreSQL pseudo-role rather than a pg_roles row. A
      -- missing real client role is reported by the assertions above; skip
      -- calling has_table_privilege with that missing name so pgTAP can
      -- finish its plan and emit the focused fail-closed diagnostic.
      where role_name = 'public' or to_regrole(role_name) is not null
    ),
    forbidden_privileges(privilege_name) as (
      values ('TRUNCATE'::text), ('REFERENCES'::text), ('TRIGGER'::text)
      union all
      select 'MAINTAIN'::text
      where current_setting('server_version_num')::integer >= 170000
    )
    select
      format('%I.%I', tables.schemaname, tables.tablename) as table_name,
      roles.role_name,
      privileges.privilege_name
    from pg_tables as tables
    cross join target_roles as roles
    cross join forbidden_privileges as privileges
    where tables.schemaname = 'public'
      and has_table_privilege(
        roles.role_name,
        format('%I.%I', tables.schemaname, tables.tablename),
        privileges.privilege_name
      )
    order by table_name, role_name, privilege_name
  $$,
  $$
    select
      null::text as table_name,
      null::text as role_name,
      null::text as privilege_name
    where false
  $$,
  'anon, authenticated, and PUBLIC have no forbidden public-table privileges (MAINTAIN included on PostgreSQL 17+)'
);

select * from finish();
rollback;
