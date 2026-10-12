# Kabuki compatibility expand

Issue #780's intermediate schema slice adds reserved metadata and a distinct
atomic application RPC. It does not activate publication freshness or recovery.
This is a local implementation contract; production application remains held.

## Schema and current application contract

- `official_import_runs.publication_ordinal` is nullable, with a dedicated
  sequence, positive Kabuki-completed constraint and non-NULL unique index.
  Existing publishers leave it NULL; this stage allocates no ordinal and
  performs no historical backfill.
- Candidates gain `recovery_review_required` (default false) and nullable
  `recovery_hold_run_id`, with a marker constraint and a second run FK.
  Current writers leave the metadata inert.
- The new `apply_official_import_kabuki_event_candidate` requires candidate ID,
  attempt token and the existing 18 reviewed Event arguments. It is a
  service-role-only, security-invoker function with an empty search path.
  Source serialization precedes the target Event and candidate locks. Current
  approval, reviewer, identity, token, lease and catalog checks still apply.
- Catalog changes and the existing candidate completion execute in one
  transaction. A failure after catalog mutation must roll the whole operation
  back. Confirmed application replay returns `applied` without another write.

Every existing function, its privileges, table grants, RLS policy and trigger
remains unchanged, including publisher and standalone completion. Candidate
state/delete guards retain their current parent locks. NULL ordinals do not
cause new eligibility refusals. No adapter, scheduler or runtime routing changes
belong in this slice. Generic claim `40001` handling is a separate runtime gate.

## Ordering and verification

The second run FK makes the old unqualified PostgREST embed ambiguous. Therefore
this migration is **runtime-first-required**: reader PR #789 must be deployed and
its explicit `official_import_candidates_run_id_fkey` selection verified before
the schema is applied. A merged PR alone is not deployment evidence.

Local verification covers actual create/update/unchanged success, late completion
failure rollback of catalog and candidate snapshots, committed lost-response
replay, ownership/identity/role refusals, and existing split-route compatibility.
Before/after schema snapshots compare existing function definitions, grants,
RLS and triggers. The existing SQL/RLS suites and actual PostgREST reader checks
preserve unrelated and ordinary-user behavior. Generated types and the full
local verification entry point are checked against the exact final schema.

Later runtime adoption, old Workflow/server drain and restrictive guard
activation are separate stages. This expand grants no freshness protection,
recovery visibility or rejection of legacy application routes, and makes no
claim that all deadlocks are impossible.
