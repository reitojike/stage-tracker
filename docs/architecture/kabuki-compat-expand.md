# Kabuki compatibility expand

Issue #780's schema slices add publication authority, recovery metadata, and a
candidate-aware atomic application path. PR #804 enabled ordinal allocation in
the owned Kabuki publisher. The follow-up schema migration activates freshness
and recovery checks on Kabuki review, claim, and catalog-write boundaries; it
also refuses unowned publication and the old split reviewed-write/completion
route. The runtime adoption below was merged and deployed in PR #793. This
schema stage does not broaden adapter catches or change schedules.

## Schema and current application contract

- `official_import_runs.publication_ordinal` is nullable, with a dedicated
  sequence, positive Kabuki-completed constraint and non-NULL unique index.
  The owned Kabuki publisher assigns an increasing ordinal when it commits a
  publication. Historical rows and historical unowned publications remain
  NULL; there is no historical backfill. The freshness gates use this order
  and refuse NULL authority for new approval, claim, or catalog writes.
- Candidates use `recovery_review_required` and nullable `recovery_hold_run_id`
  to represent unresolved recovery obligations. The owned Kabuki publisher
  derives markers from exact held-page identity and completed publication
  history; input JSON cannot choose them. Markers are immutable after insert.
  `true/NULL` preserves legacy unknown history, while a UUID identifies a
  known held run. Rejection, failed dismissal, and atomic applied evidence
  settle only the matching identity and episode.
- New unowned Kabuki publication is refused. Partial publication acquires the
  same source lock before writing held-page evidence, then rechecks the lease.
  The three existing suppression paths preserve the first recovery proposal,
  retain its current row on identical rescans, and require a new pending review
  when identity content changes. Publication ordinals, not timestamps or UUIDs,
  determine order. Historical NULL ordinals remain unknown.
- The new `apply_official_import_kabuki_event_candidate` requires candidate ID,
  attempt token and the existing 18 reviewed Event arguments. It is a
  service-role-only, security-invoker function with an empty search path.
  Source serialization precedes the target Event and candidate locks. Current
  approval, reviewer, identity, token, lease and catalog checks still apply.
- Catalog changes and the existing candidate completion execute in one
  transaction. A failure after catalog mutation must roll the whole operation
  back. Confirmed application replay returns `applied` without another write.

Existing table grants and RLS policies remain unchanged. Two internal
service-role-only SQL helpers derive recovery state and test candidate
freshness; they are not client-executable RPCs. Candidate state/delete guards
keep their terminal-parent lock rules. Legacy NULL candidates remain ineligible
for new approval, claim, or catalog writes; an already-applied replay still
returns without mutation. The run ledger and candidate rows remain the source
of truth, with no receipt table or historical backfill.

## Ordering and verification

The initial compatibility migration's second run FK makes the old unqualified
PostgREST embed ambiguous; reader PR #789 uses the explicit
`official_import_candidates_run_id_fkey` selection. This restrictive follow-up
is also **runtime-first-required**: the candidate-aware atomic route and current
freshness/recovery consumers must be deployed, and the old-route drain below
must be verified before application. A merged PR alone is not deployment
evidence.

The SQL and two-session regression suites cover create/update/unchanged success, late completion
failure rollback of catalog and candidate snapshots, committed lost-response
replay, ownership/identity/role refusals, and refusal of the old Kabuki split
route. Additional cases cover all three recovery suppression boundaries,
explicit settlement, legacy NULL authority, and both commit orders of held
publication versus atomic application. Table grants and RLS policies are not
changed. The private helpers do not add generated public RPC types.

Production activation requires the old Workflow/server and transaction drain
evidence described below. This local schema draft does not establish that
evidence or claim that all deadlocks are impossible.

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

The existing claim consumer recognizes the database's exact
`40001`/`stage_tracker.kabuki_freshness_refused.v1` result. The schema producer
now emits that marker on stale Kabuki approval, claim, and final-write refusal.
Other `40001` errors keep their existing retry behavior.

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

## Cutover and rollback order

Before deploying this restrictive schema migration, inspect the deployed runtime
identity and old-version Workflow history together. All old pinned apply runs
must have naturally finished, including queued, waiting and retrying runs that
could still issue the split RPCs. Separately confirm that database transactions
which began before the cutover have naturally ended, including idle-in-transaction
sessions. Candidate lease expiry or a successful deployment alone proves neither
drain condition. The schema guard rejects old automated Kabuki routes while the
new atomic route remains available. Broader adapter isolation and any later
workflow retirement still require their own contract and evidence. The completed
activation and drain observations are recorded in
[PR #806](https://github.com/reitojike/stage-tracker/pull/806); they are evidence
for that cutover, not for a later rollback window.

After guard activation, use this order for an application rollback:

1. Retain the installed migrations, publication ordinals, held/recovery evidence
   and database guards. Application rollback does not undo database state. Do not
   backfill historical authority, remove guards or restore the split-write route.
2. Select a known-good runtime compatible with the installed schema: the explicit
   publication-run FK reader, candidate-aware atomic apply, exact freshness-marker
   consumer, recovery-marker loader/UI and Workflow reserved-path proxy boundary.
   Old automated paths cannot bypass the installed guards. Confirmed applied
   replay remains inert; incompatible callers fail closed. An incompatible
   runtime is not a recovery target.
3. Arrange a bounded operator window without scheduled starts or new manual
   start/apply requests. Before switching, independently confirm natural completion
   of old queued/waiting/retrying Workflows and pre-switch database transactions,
   including idle-in-transaction and prepared transactions. Lease expiry, response
   loss and application rollback alone are not drain evidence.
4. Release the compatible runtime through the normal main/deployment path. Confirm
   the intended Production commit is READY, migration history matches the
   repository and the required RPC/guards remain installed before ending the
   operator window. An import or replay of historical source evidence is not a
   deployment check. If compatibility or drain is unconfirmed, hold and prepare a
   compatible forward correction while retaining the guards.

This defines the deployment rollback order; no deployment rollback drill was
performed. SQL transaction rollback and applied replay tests establish their
respective data contracts, not an executed deployment rollback.
