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

Runtime observation persistence is best effort with a short request timeout.
Storage failure emits a fixed warning with safe identifiers and does not replace
the original error classification, release/fail transition, or retry decision.
Ownership loss does not authorize an observation. Successful attempts do not
perform this extra write or fetch any additional official pages.

The schema and runtime are separate Draft PRs to obey the artifact sequencing
fence. Production migration, merge, item-level partial success, stale approval
guards, retries, parser changes, source enablement, and schedule changes require
their own reviewed scope. In particular, scheduled Kabuki/Shochiku health gates
and the Takarazuka scheduling decision remain unchanged.
