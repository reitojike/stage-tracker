# Bounded post-PR convergence

This runbook is the project-local continuation for a Task Contract that
explicitly requires `merge-ready` or post-PR convergence. It closes the
observed gap after PR creation without extending the upstream Spec Kit SDD
workflow.

## When to use it

Use this phase only when the canonical Issue or task contract requires the
agent to reach `MERGE_READY`. In that case, PR creation is an intermediate
checkpoint and the same agent/session continues immediately. A read-only
checkpoint, report-plus-STOP task, or task that explicitly stops at PR
creation keeps its original completion boundary.

The create-and-continue entry point is:

```text
pnpm run post-pr:converge -- --create \
  --title "<PR title>" \
  --body-file "<PR body file>"
```

When a PR has already been created, continue with:

```text
pnpm run post-pr:converge -- --pr <number>
```

The command uses the authenticated `gh` CLI path for PR creation, GitHub API
observation, review-thread observation, and review triggering. The
`--create` form enters the observation loop in the same process after `gh pr
create` returns; it never merges the PR.

## Repository policy

The policy is intentionally fixed and small. It is not a general delivery
configuration framework.

| Boundary            | Current policy                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR base             | `main`                                                                                                                                            |
| Required CI         | `Verify / Code`, `Verify / Build`, `Verify / Database`, `Verify / E2E`, and `Verify / Migration Ordering Fence`                                   |
| Review trigger      | A top-level `@codex review` request bound to the full current head SHA                                                                            |
| Review evidence     | Current-head Codex no-findings result, with the observed review object/top-level result surface; GitHub `APPROVED` is not required by this policy |
| Thread prerequisite | No unresolved, non-outdated current review thread                                                                                                 |
| CI wait             | 30 minutes                                                                                                                                        |
| Review wait         | 15 minutes after the current-head request or observed pending request                                                                             |
| Correction ceiling  | Two bounded correction attempts; the third attempt is `HOLD`                                                                                      |

CodeRabbit is currently configured as advisory (`auto_review.enabled: false`)
and is not the required clearing evidence for this phase.

The Vercel deployment status remains a separate pre-merge check, as defined by
[`docs/architecture/runtime-stack.md`](../architecture/runtime-stack.md). It
is intentionally not part of this repository merge-ready evaluator.

## Deterministic and semantic boundaries

The helper resolves the PR and current head on every cycle. CI observations
are read from the current head's check runs/statuses, and review evidence is
accepted only when it binds to that same head. A head mutation invalidates the
previous CI/review evidence and returns the phase to CI evaluation.

The helper reports failed checks, relevant GitHub Actions failure logs when
available, review output, and unresolved threads. The agent decides:

- whether a CI failure was caused by this change;
- whether a review finding is actionable and within scope;
- what bounded correction, if any, to make.

After a correction, verify locally, push the new head, increment
`--correction-attempt`, and rerun the command. Do not reuse evidence from the
old head. A newer review request for the same head also invalidates an earlier
no-findings result; the command remains pending until a result newer than that
request is observed. Equal or unparseable timestamps fail closed. A newer
request also starts a fresh review wait window. If the correction ceiling is
exceeded, the command returns `HOLD` before waiting for CI or requesting
another review.

Missing, pending, unknown, failed, timed-out, or differently-bound evidence
always produces `HOLD`. GitHub authentication/API failure also produces
`HOLD` with the error evidence. Only exact-head green CI, current required
review evidence, and zero unresolved current threads produce `MERGE_READY`.

## Stop boundary

`MERGE_READY` means the current exact head is ready for the repository's human
merge authority. This runbook does not auto-merge, close Issues, persist a
polling daemon, store credentials, classify failures, route reviewers, or
maintain an evidence ledger.
