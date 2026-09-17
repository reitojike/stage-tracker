# Quickstart: Notifications screen

## Prerequisites

- Node 24 and pnpm 12.4.1 are available.
- Dependencies are installed with `pnpm install --frozen-lockfile`.
- For browser/database journeys, local Supabase and Playwright Chromium are
  available through the repository setup.

## Focused validation

From the repository root:

```powershell
pnpm --filter @stage-tracker/web exec vitest run src/app/"(app)"/notifications src/lib/data/reads/notifications.test.ts src/lib/actions/notifications.test.ts
pnpm --filter @stage-tracker/web run typecheck
pnpm --filter @stage-tracker/web run lint
```

Expected results:

- populated rows retain newest-first input order and show exact copy/timestamps;
- only active sources link to `/catalog/invitations`;
- resolved rows show the exact ended message with no action;
- list/source failures render error semantics, not empty/resolved states;
- empty output uses the canonical StatePanel copy;
- only rendered IDs are passed to the post-render action and failures retain
  unread presentation.

## End-to-end journey

```powershell
pnpm run verify:e2e
```

The Notifications journey should sign in, reach `/notifications`, observe the
heading and invitation row, and follow an active source to
`/catalog/invitations`. Unit/component tests cover deterministic empty,
resolved, failure, accessibility, duplicate-effect, and read-write-failure
cases without requiring additional E2E fixtures.

## Full repository validation

```powershell
pnpm run verify
```

The CI equivalent is the required `Verify / Code`, `Verify / Build`,
`Verify / Database`, `Verify / E2E`, and `Verify / Migration Ordering Fence`
checks. This feature makes no migration, so the migration fence remains a
no-op-style required check rather than a changed artifact.

## Local environment notes

On the implementation workstation, the repository-wide `pnpm run verify:code`
format step also scans a pre-existing untracked `.worktrees/` checkout and
stops on its formatting drift; the changed files pass the focused format check.
The local `verify:e2e` attempt is blocked before test execution because Docker
Desktop's Linux engine is not running. A direct production build is likewise
blocked by the managed dependency installation missing the existing `server-only`
package; these are environment limitations, not Notifications behavior results.
