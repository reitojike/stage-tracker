<!--
Delete the "Migration ordering" section entirely if this PR adds no new
file under supabase/migrations/. If it does, keep the section and fill in
exactly one of the two marker lines below - `Verify / Migration Ordering
Fence` (scripts/check-migration-ordering-fence.mjs) reads the literal text
of this PR body for these markers before it will pass. See
docs/architecture/runtime-stack.md "デプロイ・実行経路" for the criteria
(Issue #131).
-->

## Migration ordering

<!-- Keep exactly one of the next two lines, delete the other. -->

Migration ordering: post-deploy-safe
Migration ordering: schema-first-required

<!--
If "schema-first-required": apply the migration to Production BEFORE
merging this PR (operator action - see docs/runbooks/
gate-a-remote-environment.md "Schema migration to the hosted project"),
confirm with `npm run supabase:migrations:drift -- --linked`, then add:

Production migration applied: <short evidence, e.g. "supabase db push
--linked at 2026-08-27, drift check confirms synced">

Do not paste Production credentials, project refs, or other secrets here -
see docs/runbooks/gate-a-remote-environment.md "Secret boundary".
-->
