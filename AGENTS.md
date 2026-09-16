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
- `docs/v2/**` and other migration-era or historical documents are discoverable
  evidence, not current normative authority, unless the document explicitly
  says it is current. Historical intent belongs to GitHub and Git.
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
- This router does not revive the retired Foundation-generated guidance,
  external checkout/pin/sync dependency, or provider/model-specific operating
  rules. If a capability is genuinely missing, record the evidence in the task
  and reassess it separately.
