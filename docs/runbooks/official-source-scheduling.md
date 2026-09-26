# Official source scheduling (Phase 1)

This runbook covers promoting one already-working shadow source to scheduled
ingestion. Scheduled runs only stage review candidates; they never approve,
apply, or delete catalog data automatically. Issue #634 is the rollout tracker.

## Current rollout state

- Kabuki Event is the only source with `scheduledEnabled: true`; every other
  source remains unscheduled. Its weekly due slot is Monday in Asia/Tokyo.
- `ticket.shochiku.schedule` remains manual shadow only. Its adapter reads
  public Kabuki-bito play detail ticket starts as preliminary general-sale
  evidence, then the Shochiku east/west sale rows. One source/run reconciles
  the same Event's general sale: a later Shochiku date change replaces the
  preliminary date, while a Shochiku date-only row for the same day does not
  erase a Kabuki-bito explicitly published clock. Shochiku member tiers remain
  separate opportunities. Differently titled productions are not paired by
  substring alone; unresolved Event identities remain review-blocked;
  approval/apply is never automatic. The creator's `/catalog/imports` page has
  a separate manual ticket shadow button and latest held-page report.
  A 2026-09-25 read-only live scan parsed 71 distinct ticket drafts: 13 from
  Kabuki-bito detail pages and 58 from Shochiku east/west, with zero held play
  pages. Kabukiza #986 yielded general sale 2026-10-14 10:00 JST from its
  [official ticket section](https://www.kabuki-bito.jp/theaters/kabukiza/play/986).
  This did **not** stage Production candidates or prove catalog linkage,
  unchanged-run suppression, or apply convergence. Do not schedule the ticket
  source until a clean Production manual canary and operator policy/cadence
  review are recorded. The [Shochiku terms](https://www1.ticket-web-shochiku.com/t/info/rules.html)
  reserve rights in site content; its `/robots.txt` returned 404 on this
  check, which is not positive permission. Reuse only normalized facts and
  source links within the accepted private-household boundary; do not retain
  or republish page prose, images, or raw HTML. A separate operator judgment
  is needed before its Cron promotion. The daily Cron entry already exists,
  so a time-bounded daily ticket trial needs only a source-specific cadence
  decision and `scheduledEnabled` promotion; no second Cron or secret is needed.
- The Production-only machine-auth route is exactly
  `/api/official-import/cron`. The proxy lets this path reach its route handler
  without a Supabase user session; the handler still requires the
  `CRON_SECRET` bearer. This exception does not apply to
  `/api/official-import/shadow` or other application/API paths.
  `apps/web/vercel.json` registers one daily 00:00 UTC Cron call; on other Tokyo
  weekdays it has no due source. No source is approved or applied by Cron.
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
  changes fail closed. A fully validated approximate closing-time note supplies
  a provisional occurrence end and a source-check memo; an absent or malformed
  note never creates an end. An act-by-act `上演時間` section takes precedence
  and may supply a final-act end only for the observed official timetable
  structure: each named part or explicit opening-clock header matches its
  verified headline opening, each act has a readable time range, and the footer
  is recognized. A verified daily calendar may use those ends only when every
  performed cell explicitly repeats its part's headline clock; program markers
  or changed daily clocks do not receive a uniform end. A present but unreadable
  `上演時間` section holds the page for human review; an absent section leaves a
  verified approximate end in place.
  If an existing occurrence has an end but the same opening in the latest
  parsed proposal has no verified end, stage no update for that play. Report the
  page as `published_end_missing`; keep the catalog end until a person checks it.
  This report does not automatically revoke older candidates. Approval and
  catalog apply are separate human actions; check the latest official page and
  held report before acting on an older candidate.
  Staged ends still require human review. A single-month daily calendar
  is read only when the complete permitted headline notes and
  the PC/mobile table views agree on every day and part. A/B program and
  circle markers use an explicit base clock for their part; numeric cells
  retain their own exact clocks. Unknown table symbols, notes, or combinations
  of otherwise known note forms remain held until separately verified.
  A single `★` on a numeric clock may retain that exact clock only when the
  same date/part marker appears in both calendar views, the headline note and
  the calendar footer agree on its referent, and the note contains no
  scheduling-change language. The candidate then carries a fixed reminder
  to inspect the official page before review/apply; the note prose itself is
  not copied into the candidate. A missing, mismatched, or time-changing note
  remains held. This covers the observed Asakusa #1000 annotation without
  assuming that every future marked note is harmless.
  The observed non-scheduling prose on Kabukiza #986 and Minamiza #965 is
  accepted only by exact normalized fingerprints; any edit to those notes
  holds the page for human review, even if the table is unchanged.
  A headline is never used to guess times through a table. Exact-dated pages
  with no published opening clock and no calendar may produce an Event-only
  candidate with zero Occurrences only for an empty timetable, a validated
  rest-day list, or the exact observed non-scheduling note fingerprint on
  Kabukiza #997. Other notices, including part-only notes, remain held;
  month-only teasers are skipped. A published clock or unresolved schedule
  must not be downgraded to Event-only.
  A detail page that fails strict schedule parsing may be reported as a held
  page while verified sibling pages stage review candidates. The held record
  contains only the official URL, id, title, date range, and bounded reason
  code; it contains no raw page or error prose. Index, fetch/provider, and
  ownership failures still fail the entire run. A completed partial run is
  **not** by itself a clean promotion canary: compare every exact-dated index
  row with staged or held identities, inspect the major-theater coverage and
  held reasons, and record operator acceptance of the omissions before
  scheduling. Month-only teasers remain excluded. The 2026-09-25 read-only
  full-index audit found 26 unique play links: 21 exact-dated rows, with 15
  timed proposals, five Event-only proposals, and one held London local-time
  page (#1006). All 14 exact-dated pages at Kabukiza, Minamiza, Misonoza, and
  Hakataza were accounted for as timed or Event-only. The operator accepted
  leaving #1006 held and confirmed a subsequent unchanged manual Production
  run created no new candidates. The 30-link index ceiling remains a
  fail-closed operational watchpoint.
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
   behavior on ambiguous or malformed data. For a source with page-level held
   reporting, every exact-dated index row must be accounted for as a verified
   candidate or an explicit held page; review the measured omissions rather
   than treating successful completion as proof of full coverage.
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

For the Kabuki manual Production shadow check, a designated catalog creator can
open `/catalog/imports` and select **歌舞伎を手動取得** once. This starts only
`event.kabuki-bito.schedule` and does not approve or apply candidates. Wait for
the Workflow to finish, refresh the page, and inspect both the candidate queue
and latest held-page report before another run. The button is not a substitute
for the separate per-source scheduling gate.

For a TicketOpportunity whose Event identity is blocked, `/catalog/imports`
shows up to five possible Events from the same venue and year when the source
provides those facts. These are suggestions, not automatic matches; compare
the official page's title and period with the Event before selecting one. If
none is right, paste the existing catalog Event URL or UUID, inspect its
preview, then select **このEventに紐づけて承認**. This records the reviewed binding for
later scans of the same ticket source identity, but does not apply the ticket;
**カタログへ反映** remains a separate step. Active manually registered Events
without a `source_key` may also be bound; the reviewed Event ID is retained.
A canceled/deleted or identity-changed Event is
held again rather than silently redirected. Do not select a merely similar Event
when the source actually describes a distinct performance.
If a manually bound candidate would update an already-existing TicketOpportunity,
apply stops with `source_changed`: the unresolved candidate did not display that
update for review. Run the ticket scan again and inspect the newly resolved
change before approving it.
If an approved candidate's apply has failed and the operator confirms it no
longer needs action (for example, a more precise TicketOpportunity is already
in the catalog), select **対応不要として閉じる**. This removes only the failed candidate
from the active review queue; its approval, failure, closing actor, and closing
time remain in the database. Closing cannot delete catalog data or retry the
failed apply. Do not use it for a change that still needs a fresh review.

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
