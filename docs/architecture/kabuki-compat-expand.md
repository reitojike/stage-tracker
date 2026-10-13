# Kabuki compatibility expand

Issue #780's intermediate schema slice adds reserved metadata and a distinct
atomic application RPC. PR #804 also enables ordinal allocation in the owned
Kabuki publisher. This records source-serialized publication order; it does not
introduce freshness or recovery refusal conditions or complete a system-wide
runtime transition. The schema slice was deployed in PR #792. The limited
runtime adoption below was merged and deployed in PR #793. A freshness-refusal
producer, recovery-refusal conditions and restrictive guard activation remain
later, separately authorized stages.

## Schema and current application contract

- `official_import_runs.publication_ordinal` is nullable, with a dedicated
  sequence, positive Kabuki-completed constraint and non-NULL unique index.
  The owned Kabuki publisher assigns an increasing ordinal when it commits a
  publication. Historical rows and unowned direct-publisher writes remain
  NULL; there is no historical backfill. Ordinals record publication order,
  but do not themselves refuse stale publications or activate freshness or
  recovery refusal behavior.
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
cause new eligibility refusals. No adapter, scheduler or system-wide runtime route changes belong in this slice. Generic claim `40001` handling is a separate runtime gate.

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

Other runtime adoption, freshness-refusal production, recovery-refusal
conditions, old Workflow/server drain and restrictive guard activation are
separate stages. Ordinal allocation records publication order; it does not add a freshness-
refusal condition or recovery-refusal behavior. Legacy application routes remain
accepted, and this slice makes no claim that all deadlocks are impossible.

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
remains unchanged, without reading, completing or failing the candidate.

## Freshness refusal consumer

SQLSTATE `40001` alone cannot distinguish a freshness refusal from an ordinary
serialization conflict, or identify the source before a claim succeeds. The
runtime therefore recognizes a refusal only when the claim error has exactly
code `40001` and exactly details `stage_tracker.kabuki_freshness_refused.v1`.
This reserved marker is a Kabuki-only producer contract. Ordinary `40001`,
other details, authorization and transport errors keep the existing
exception/retry handling.

A recognized refusal returns a candidate-bound `freshness_refused` Workflow
result before ownership. It does not plan, write, complete or fail the
candidate, so the candidate's persisted state is unchanged.

For approved Kabuki Event candidates, the review queue component keeps each
started candidate ID, run ID and display title in its own memory and offers a
manual result check. These entries survive candidate row removal and props
refresh on the current page, but a hard reload clears them. There is no
storage, history or receipt guarantee. A refusal message says only that the
candidate cannot be treated as current, not that an official update was
observed. The authenticated
check requires the designated creator, an RLS-visible candidate with the Kabuki
Event source and kind, a run whose recorded workflow name equals the compiled
apply workflow ID, and a completed result with the same candidate ID. It reads
the run status once and reads the return value only for a completed run. It
never waits, polls, restarts or cancels the run, and returns only a fixed
outcome. Pending runs and lookup failures do not assert candidate failure or
start another apply. Other sources keep the start-only flow.

No database producer emits the marker yet. The producer, legacy drain and
restrictive guard activation remain later, separately authorized stages. This
consumer performs no production drain, guard activation, freshness or recovery
enablement, scheduled import, or cadence change.

## Recovery review marker consumer

The review loader requires both existing recovery marker columns and accepts
only (false, NULL), (true, NULL), and (true, UUID). A true marker is limited to
Kabuki Event candidates. Missing or malformed values and markers on other
sources or candidate kinds fail the queue read closed. The existing completed-run
FK embed and filter remain unchanged; the loader does not fetch the held run.

Marked candidates remain visible when their exact-identity plan is unchanged.
The queue keeps the honest no-change plan and adds a fixed re-review-required
notice without inferring a hold episode from timestamps or creating local
settlement state. The marker does not change identity, creator, review, apply,
reject, failed-dismiss or lease controls; server props remain authoritative.

## Later guard activation

Before a later restrictive guard activation, inspect the deployed runtime
identity and old-version Workflow history together. All old pinned apply runs
must have naturally finished, including queued, waiting and retrying runs that
could still issue the split RPCs. Separately confirm that database transactions
which began before the cutover have naturally ended, including idle-in-transaction
sessions. Candidate lease expiry or a successful deployment alone proves neither
drain condition. Keep the compatibility functions while this evidence is absent.
The runtime adoption slice performed no production drain, guard activation,
freshness or recovery enablement, scheduled import, or cadence change.
