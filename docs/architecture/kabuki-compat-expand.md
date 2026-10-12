# Kabuki compatibility expand

Issue #780's intermediate schema slice adds reserved metadata and a distinct
atomic application RPC. It does not activate publication freshness or recovery.
The schema slice was deployed in PR #792. Runtime adoption is a separate slice;
its merge and production execution remain held until separately authorized.

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

## Limited runtime adoption

Only approved `event.kabuki-bito.schedule` Event candidates use the new RPC.
The shared reviewed Event builder retains its 18 arguments, including expected
catalog snapshots, child fixes and explicit classification flags. The runtime
adds the persisted candidate ID and existing step-derived attempt token.
Candidate-aware mode requires one reviewed Kabuki Event plan and confirms only
the exact `applied` result. It has no fallback to the old split write/completion
route. Other Event sources, Ticket and manual imports retain their current route.

The gateway marks this completion atomic. Both normal and converged apply paths
therefore omit a separate completion RPC. Current approval, reviewer, identity,
token and lease checks remain the database's responsibility. A lost response is
successful only when the existing failure transition or subsequent claim proves
the candidate already applied. An unconfirmed result follows the existing
failure/ownership retry contract; retry limits and timing remain unchanged.

A failed claim establishes no ownership. Its existing exception/retry behavior
remains unchanged, without reading, completing or failing the candidate. The
shared claim RPC does not currently emit intentional freshness `40001` errors;
that SQLSTATE alone cannot distinguish a future freshness refusal from an
ordinary serialization conflict, or identify the source before claim succeeds.
Changing all sources to a terminal `source_changed` result needs a separate
scope decision. The existing queue does not read Workflow results, so classifying
an outcome alone would not implement user-facing delivery. Both classification
and delivery remain gates for a separately reviewed change.

Before a later restrictive guard activation, inspect the deployed runtime
identity and old-version Workflow history together. All old pinned apply runs
must have naturally finished, including queued, waiting and retrying runs that
could still issue the split RPCs. Separately confirm that database transactions
which began before the cutover have naturally ended, including idle-in-transaction
sessions. Candidate lease expiry or a successful deployment alone proves neither
drain condition. Keep the compatibility functions while this evidence is absent.
This runtime slice performs no production drain, guard activation, freshness or
recovery enablement, scheduled import, or cadence change.
