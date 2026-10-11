# Official import failure observations

Issue [#761](https://github.com/reitojike/stage-tracker/issues/761), under
[#634](https://github.com/reitojike/stage-tracker/issues/634), adds one compact
latest failure observation per existing import run. This is an observation
boundary, not a change to ingestion behavior.

The service-role-only `record_owned_official_import_failure_observation` RPC
locks the run and accepts writes only for its matching source, active owner
token, running status, and unexpired lease. It does not claim or renew a lease,
publish candidates, complete or fail a run, approve a candidate, or apply catalog
changes. Direct writes are denied. Catalog creators can read observations;
ordinary authenticated users and anonymous clients cannot.
The run foreign key cascades only an already-permitted run deletion, preserving
the existing running/unclaimed cleanup boundary. It introduces no deletion job;
claimed and terminal run deletion guards remain unchanged.

The record contains a timestamp, source/run identity, phase, bounded reason code,
optional safe official URL/identity, and provisional progress counts. There is no
raw page, image, error message, response, ownership token, or generic JSON payload.
The runtime must validate URLs against the source registry, remove query and
fragment, exclude user information, and drop unsupported identity characters.
SQL constraints enforce a compact representation, not source authorization.

Acquisition failures have an unknown returned draft count and zero validated
candidates. Planning/publication failures know how many drafts acquisition
returned. Validated candidates are only those constructed in memory before
failure; holds are only those discovered before failure. None of these counts
prove complete source coverage, candidate publication, or absence/deletion of
official items. A publication failure has no implicated individual item.

A later owned failure replaces the record. A successful retry preserves the
historical clue; the existing run status remains authoritative. Read the
observation together with the run status and observation timestamp, never as an
independent current failure status or scheduled-run health result.

Runtime observation persistence is best effort with a two-second client request
timeout. Storage errors emit a fixed warning with safe identifiers; the original
error classification is then passed to the existing release/fail operation.
Ownership loss does not authorize an observation. Successful attempts do not
perform this extra write or fetch any additional official pages.

## Compatibility and deployment

The expansion adds no required column or change to existing tables/RPCs. Old
runtime works with the expanded schema. The dependent runtime can also run before
the new RPC exists: the missing-RPC error is caught, a fixed diagnostic warning is
emitted, and the original failure operation is attempted. Failure clues will be
missing, so deploy the additive migration and verify its RPC/grants before
deploying the runtime. After the schema PR merges, retarget the runtime PR to
main, reconcile its base, and repeat exact-head checks/review before its merge.

Application rollback can restore the old runtime while leaving the additive
table/function in place. No down migration is supplied. Dropping the RPC/table
would discard historical diagnostic facts and needs separate data-removal
approval; disable/roll back the runtime first. No migration has been applied to
production by this task.

## Known runtime gate: lease-boundary timing

The current runtime Draft awaits diagnostics after stopping the lease heartbeat.
The existing terminal-failure RPC rejects an expired lease. A diagnostic stall
can therefore cross a near-expiry lease and turn a terminal source/validation
failure into an ownership-loss retry. Client abort does not prove server
cancellation or a bounded database row-lock lifetime. Late observations still
check the locked run's current owner/status before writing and cannot publish
candidates or alter run status, but may complete after the client times out.

This is a blocking qualification to the observation-only outcome-preservation
criterion. Keep the runtime Draft on HOLD pending a separately reviewed remedy;
do not approve it on a claim that the timeout always preserves the original
outcome. Do not add lease renewal, extra retries/fetches, unawaited writes, or
changes to the authoritative failure transition without that review.

The schema and runtime are separate Draft PRs to obey the artifact sequencing
fence. Production migration, merge, item-level partial success, stale approval
guards, retries, parser changes, source enablement, and schedule changes require
their own reviewed scope. In particular, scheduled Kabuki/Shochiku health gates
and the Takarazuka scheduling decision remain unchanged.
