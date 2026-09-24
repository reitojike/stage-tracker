# Official source scheduling (Phase 1)

This runbook covers promoting one already-working shadow source to scheduled
ingestion. Scheduled runs only stage review candidates; they never approve,
apply, or delete catalog data automatically. Issue #634 is the rollout tracker.

## Current safe state

- Every source in the code-owned Source Registry has `scheduledEnabled: false`.
- The Production-only machine-auth route is exactly
  `/api/official-import/cron`. The proxy lets this path reach its route handler
  without a Supabase user session; the handler still requires the
  `CRON_SECRET` bearer. This exception does not apply to
  `/api/official-import/shadow` or other application/API paths.
  `apps/web/vercel.json` has no Cron registration. No scheduled acquisition is
  active.
- The route requires a Production `CRON_SECRET` of at least 32 characters and
  Vercel's `Authorization: Bearer <secret>` header. Missing configuration fails
  closed. Never store or print the value in the repository, PRs, or logs.
- A daily Cron slot uses the Asia/Tokyo date. Weekly sources are due only on
  Monday in Asia/Tokyo. Duplicate delivery of a slot uses the same durable run
  identity; the database permits one live attempt lease per source and suppresses
  unchanged candidates from completed runs. An active Workflow step refreshes
  its own lease while acquiring and planning. It stops and drains the renewal
  before candidate commit, failure, or release, so a delayed renewal cannot
  reclaim a released attempt. A failed renewal stops further heartbeats and
  conditionally releases a still-owned lease before retrying.
- Initial rollout preference (2026-09-23): Kabuki Event first, weekly. Its
  adapter bounds a scan to 30 play pages, fetching at most two at a time with a
  pause between batches. An index over the cap fails closed rather than being
  silently truncated.
  The 2026-09-24 read-only canary found teaser duplicates, month-only future
  listings, and varying detail schedules. Explicit per-date headline times
  can be parsed only when every date in the listed range is covered, without
  inventing shows. On pages without a daily calendar, an explicit performance
  period and standard part time (or a single unlabeled time) are expanded only
  when every full rest day and part-specific private exception is completely
  parsed. The exact school-group attendance note is validated as informational
  and does not remove public occurrences. Unknown notes and date-specific
  changes fail closed. A fully validated approximate closing-time note is
  informational and never becomes an exact occurrence end. A single-month
  daily calendar is read only when the complete permitted headline notes and
  the PC/mobile table views agree on every day and part. A/B program and
  circle markers use an explicit base clock for their part; numeric cells
  retain their own exact clocks. Unknown table symbols or notes remain held.
  A headline is never used to guess times through a table. Exact-dated pages
  with no published opening clock and no calendar may produce an Event-only
  candidate with zero Occurrences; month-only teasers are skipped. A published
  clock or unresolved schedule must not be downgraded to Event-only. The
  current bounded read-only scan still has unsupported detail pages, so this
  source has **not** passed its source-wide shadow canary or promotion gate.
  Takarazuka Event also has a weekly cadence preference but remains unscheduled.
  The private-household product boundary is settled in
  [#681](https://github.com/reitojike/stage-tracker/issues/681); the exact
  Cron machine-auth path is implemented by
  [#682](https://github.com/reitojike/stage-tracker/issues/682).
  [Issue #677](https://github.com/reitojike/stage-tracker/issues/677#issuecomment-5796382733)
  judged a later bounded private-household, facts-only rollout reasonable, not
  automatically permitted. Before promotion, re-check its
  [official site policy](https://kageki.hankyu.co.jp/rules.html), record the
  operator's acceptance of remaining site-policy uncertainty, enforce a hard
  source-specific request ceiling, and complete its own clean shadow canary.

## Per-source promotion gate

Record evidence in the source's rollout PR or Issue comment before changing its
`scheduledEnabled` flag. All of the following are required:

1. The operator has reviewed the source-specific terms, robots instructions,
   permission to access the intended public pages/API, and a suitable request
   cadence/rate limit. Technical reachability is not policy clearance.
2. The adapter has a clean, bounded shadow canary on current official content:
   correct physical-event relevance, event/occurrence/ticket precision,
   complete pagination or page coverage, no invented times, and fail-closed
   behavior on ambiguous or malformed data.
3. Stable source identity and content-hash behavior are demonstrated. An
   unchanged second run stages zero duplicate review candidates; changed
   content or plan remains reviewable. Include retry, provider-failure, and
   cross-source same-Event evidence where applicable.
4. The source is already `enabled: true`, `shadow: true`, and
   `policyState: "approved"`. A source in `planned` or `hold` cannot be promoted
   by changing only `scheduledEnabled`.
5. Raw HTML, PDF bytes, and provider responses are not retained as durable
   candidates. Review and apply remain human-gated.

Promote one source at a time. Leave Vpass and the Takarazuka Friends PDF source
disabled until their separate policy and extraction gates pass. An all-day
calendar record does not establish an exact showtime or physical-event
relevance by itself.

## Enable and observe

1. Verify the exact-path Cron machine-auth/proxy implementation from
   [#682](https://github.com/reitojike/stage-tracker/issues/682): sessionless
   Cron requests must reach the route while other protected routes remain
   default-deny. Register `CRON_SECRET` as a Production environment
   variable in the Vercel project. It is separate from the ingestion Supabase
   secret key. Verify only the variable name/presence, not its value.
2. In a source-specific PR, set only the cleared source's `scheduledEnabled` to
   `true`. For the first source, add a daily UTC Cron registration for
   `/api/official-import/cron` to `apps/web/vercel.json`; later sources use the
   same route and their code-owned daily/weekly cadence. Never register a
   separate job per source without revisiting the overlap/rate evidence.
3. Run the repository's pre-PR gate and post-PR convergence. After merge,
   confirm the Production deployment succeeded before treating Cron as active.
4. Observe the first two due slots: `official_import_runs` counts and statuses,
   candidate/review/apply outcomes, unchanged-run zero-candidate behavior,
   failure classification, request volume, and approximate provider cost.
   Check that separate official sources for the same Event did not create a
   duplicate catalog Event. Record evidence on #634.
5. If acquisition or policy evidence regresses, set `scheduledEnabled` back to
   `false` in a rollback PR. Candidate approval and catalog apply remain
   separate; do not use them as a rollback mechanism.

Vercel Cron delivery may be duplicated or delayed and has no automatic retry.
The route's same-slot identity and database lease guard bound duplicate work,
but an operator should inspect failed or missing runs rather than assuming
exactly-once delivery. A source failure should not stop the route from
attempting other due sources.
