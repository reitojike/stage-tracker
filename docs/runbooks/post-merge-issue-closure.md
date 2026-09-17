# Bounded post-merge Issue closure

This runbook is a separate phase after
[`post-pr-convergence.md`](post-pr-convergence.md). The post-PR phase still
ends at `MERGE_READY`; it does not merge PRs or close Issues.

Use this phase only when the canonical Issue / Task Contract says that the
merged implementation completes that Issue and the agent has authority to
perform the completion actions. Do not use it for a read-only checkpoint,
report-plus-STOP task, parent/coordination/umbrella/tracking Issue, a task with
known follow-up work, a close-prohibited task, or a task whose semantic close
reason is not `completed`. If applicability is uncertain, stop at `HOLD`.

The repository entry point is:

```text
pnpm run post-merge:closure -- <command> ...
```

The helper is deliberately narrow. It reads the current Issue and the
explicitly supplied implementation PR through the authenticated GitHub `gh`
CLI/API path. It checks deterministic prerequisites, but it never decides
whether an Acceptance Criterion is satisfied, whether an Issue is a parent or
tracking item, or whether post-merge work remains. Those are agent judgments
and must be supplied as explicit assertions.

## Procedure

### 1. Obtain a fresh snapshot

Run this after the implementation PR is confirmed merged:

```text
pnpm run post-merge:closure -- snapshot --repo owner/name --issue <issue> --pr <pr> --json
```

The output contains the fresh Issue body, a body SHA-256 value, the PR merge
state/SHA, and the parsed AC items. The parser accepts only one exact
`## Acceptance Criteria` section with top-level `- [ ]` / `- [x]` items. A
missing, duplicate, nested, or otherwise ambiguous section is `HOLD` for
closure purposes; do not repair it heuristically.

### 2. Perform semantic verification

Using the fresh body and the merged code, tests, CI, review, and durable
artifacts, review every AC one at a time. Select only criteria that the
evidence actually satisfies. Leave unmet, deferred, scope-external, or
uncertain criteria unchecked.

Before any mutating command, the agent must be able to affirm all three of
these facts:

```text
--allow-completion
--semantic-ac-verified
--no-known-remaining-work
```

These flags are assertions, not a semantic classifier. Omitting any one makes
the helper fail closed.

### 3. Update only satisfied AC checkboxes

Use the `bodySha256` from the fresh snapshot and repeat `--check-index` for
each satisfied AC. For example:

```text
pnpm run post-merge:closure -- update --repo owner/name --issue <issue> --pr <pr> --expected-body-sha256 <snapshot-sha256> --check-index 1 --check-index 4 --allow-completion --semantic-ac-verified --no-known-remaining-work
```

The helper fresh-reads the Issue immediately before writing, refuses a body
hash mismatch, applies the delta to that fresh body, and fresh-reads the body
again to confirm the expected checkbox state. It changes only the selected
direct checklist lines. GitHub's standard Issue update is a full body
replacement and does not provide a documented atomic conditional body write;
the helper therefore does not pretend to provide an optimistic-locking
framework. Do not run this mutation while another editor or bot may be
changing the Issue. If that safe window cannot be established, use `HOLD`.
Any API/auth/write-confirmation failure is also `HOLD`.

If an AC is not satisfied, do not select its index. If any unchecked AC remains,
do not continue to evidence or close.

### 4. Add durable completion evidence

Prepare a short text file outside tracked repository files with at least these
fields, using the actual values:

```text
Implementation PR: #<pr>
Merge commit: `<40-character merge SHA>`
Acceptance Criteria: every item was reviewed individually and satisfied.
Verification: <relevant CI/tests and other verification>
Review: <relevant exact-head review evidence>
Unresolved items: 0
```

Then run:

```text
pnpm run post-merge:closure -- evidence --repo owner/name --issue <issue> --pr <pr> --evidence-file <path> --allow-completion --semantic-ac-verified --no-known-remaining-work
```

The helper adds a small identity marker containing the Issue number, PR
number, and merge SHA; it checks for that marker first and does not post a
duplicate sufficient comment. Missing required fields, a malformed existing
comment, or an API/auth/confirmation failure is `HOLD`.

### 5. Verify, then close

Run the deterministic prerequisite check:

```text
pnpm run post-merge:closure -- verify --repo owner/name --issue <issue> --pr <pr> --allow-completion --semantic-ac-verified --no-known-remaining-work
```

Only `READY_TO_CLOSE` permits the final command:

```text
pnpm run post-merge:closure -- close --repo owner/name --issue <issue> --pr <pr> --allow-completion --semantic-ac-verified --no-known-remaining-work
```

`close` performs another fresh Issue/PR/comment read, rechecks the Issue body
before mutation, uses a state-only GitHub update, and confirms
`state=closed` with `state_reason=completed`. It never closes a PR's Issue
merely because the PR is merged.

The close guard requires all of the following:

- Issue is currently open;
- the agent explicitly affirmed completion applicability, per-item semantic
  AC verification, and no known remaining work;
- the supplied implementation PR is merged and has a full merge SHA;
- the explicit AC section is unambiguous and has zero unchecked items;
- sufficient identity-matched completion evidence exists; and
- the final fresh-read state update is accepted and confirmed.

Any failed, unknown, stale, concurrent, or ambiguous condition remains
`HOLD`; do not retry by weakening an assertion or by editing unrelated Issue
content.

## Canary and continuity boundary

Issue #517 / PR #518 is a read-only negative example: the PR is merged but the
Issue is open with unchecked AC, so it must remain `HOLD` and must not be
closed by this task.

Issue #527 itself may be used as a bounded self-canary only after its
implementation PR is merged by explicit merge authority. That proves the
procedure, semantic checkbox update, deterministic guard, evidence, and close
path. Because the implementing session already knows this routing, it does not
prove future-agent discovery or automatic post-merge continuation. The next
naturally closable real-work Issue must supply that separate continuity proof:
merge, no extra user prompt, fresh Issue read, semantic AC review, checkbox
update, evidence, and `completed` close.

No daemon, webhook, Issue/PR registry, arbitrary-Markdown parser, semantic
classifier, lifecycle engine, custom Skill, reviewer router, evidence ledger,
or Foundation compatibility layer belongs in this phase.
