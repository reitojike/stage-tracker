# Repository guidance

This is a hand-written, project-owned authority router. It is a table of contents
for the current repository guidance, not a second specification or a generated
policy bundle.

## Start here

- The canonical change intent for a task is its GitHub Issue and the relevant
  pull request. Use Git history for what changed and why; do not treat an old
  branch, commit, or migration note as current behavior by itself.
- Project principles and artifact responsibilities live in
  [`.specify/memory/constitution.md`](.specify/memory/constitution.md).
- Current user-visible product behavior lives in the relevant Living Spec under
  [`specs/**/spec.md`](specs/). For Occurrence Participation, start at
  [`specs/001-occurrence-participation/spec.md`](specs/001-occurrence-participation/spec.md).
- Current structure and boundaries live in
  [`docs/architecture/`](docs/architecture/).
- Current operational procedures live in [`docs/runbooks/`](docs/runbooks/).
- For Task Contracts that explicitly require merge-ready, use the bounded
  continuation in [`docs/runbooks/post-pr-convergence.md`](docs/runbooks/post-pr-convergence.md)
  after PR creation; its `MERGE_READY` result is the stop boundary.
- Mechanical correctness and safety are enforced by executable configuration,
  tests, and CI. The normal repository verification entry point is
  [`pnpm run verify`](package.json); inspect the applicable workflow in
  [`.github/workflows/`](.github/workflows/) for CI authority.
- Domains without a Living Spec may use
  [`.ai-dev-foundation/product-rules.md`](.ai-dev-foundation/product-rules.md)
  as temporary static product authority only. This file is not a runtime
  harness or a permanent substitute for a domain Living Spec.

## Authority boundaries

- Keep product behavior, architecture, procedures, mechanical enforcement, and
  change history in their respective artifacts. Do not copy their detailed
  contents into this file.
- A Spec Kit artifact generated while implementing a task is a work artifact
  until the repository explicitly designates it as a current Living Spec. Do
  not infer current product authority from a filename alone.
- Migration-era or historical documents are supporting/history rather than
  current normative authority for topics whose authority cutover is complete.
  Do not infer historical status from the `docs/v2` path alone; mixed documents
  remain source material until their current content is extracted or superseded.
  Historical intent belongs to GitHub and Git.
- The public application keeps its product and data boundaries in the current
  Living Spec, architecture, schema, tests, and CI. When these responsibilities
  appear to disagree, re-read the canonical artifacts and the task Issue before
  making a new rule.

## Working boundary

- Use the applicable GitHub Spec Kit standard workflow and its project
  integrations (`.agents/skills/speckit-*` or `.claude/skills/speckit-*`) when a
  task benefits from them. Keep generated task artifacts scoped to that task.
- Prefer standard or existing project capabilities. Do not add a custom
  authority index, compatibility layer, generated/sync router, or equivalent
  process machinery without a demonstrated project need recorded in the
  canonical task context.
- A merge-ready Task Contract treats PR creation as an intermediate checkpoint
  and continues into the bounded post-PR phase without an additional user
  prompt. This does not override read-only, report-plus-STOP, or explicit
  PR-creation STOP contracts.
- When the primary implementation provider is known from the canonical Task
  Contract or handoff, prefer an independent semantic review by a different
  provider when that provider is available. The current required deterministic
  merge-ready review remains a top-level `@codex review` and is not replaced by
  this preference.
- A Claude implementation is covered by the required Codex review as its
  cross-provider review; do not add another reviewer by default. For a Codex
  implementation, prefer a Claude independent semantic second opinion when
  available, in addition to the required Codex review.
- Cross-provider review is optional for a normal Task unless the canonical
  Task Contract explicitly makes it required. Unavailability or lack of
  machine-observable evidence for an otherwise optional cross-review alone
  must not block the normal deterministic `MERGE_READY` contract. A high-risk
  Task (for example auth, RLS, security boundaries, secrets, migrations,
  destructive data operations, release safety, or the review/convergence
  mechanism itself) may make cross-provider review required in its Task
  Contract; this is an explicit task judgment, not a general classifier.
- This router does not revive the retired Foundation-generated guidance,
  external checkout/pin/sync dependency, provider/model-specific capability
  rules, reviewer routing, provider abstraction, quorum, or compatibility
  machinery. If a capability is genuinely missing, record the evidence in the
  task and reassess it separately.
