# Research: Notifications screen

## Decision: Reuse the existing authenticated `(app)` route group

**Rationale**: `apps/web/src/app/(app)/layout.tsx` owns the authenticated
AppShell, while `src/proxy.ts` default-denies unknown paths. A page under the
group provides the required `/notifications` route without adding an auth
framework or changing public-path policy.

**Alternatives considered**: A route outside the group would lose shared
authenticated chrome; a new route guard would duplicate `requireAuthenticatedUserId`
and violate the current boundary.

## Decision: Consume #512's typed list and read action unchanged

**Rationale**: `listMyNotifications` already enforces the recipient-owned
Supabase client boundary, a 50-row first window, deterministic
`created_at DESC, id DESC` ordering, and batched source resolution. The existing
`markNotificationsReadAction` deduplicates and bounds exact IDs before calling the
recipient-owned idempotent RPC and revalidates the affected surfaces.

**Alternatives considered**: Direct table queries, a route-local source query,
or a new action would duplicate authority and could broaden the rendered
snapshot. A global client store would add an unneeded cache authority.

## Decision: Use a minimal client post-render boundary

**Rationale**: Server Components can render the list snapshot, but the read
mutation must run only after the rows reach the client. Passing the exact rendered
IDs to a small client component and calling the existing action from an effect
preserves the race-safe contract. Local display state may converge to read only
after a successful action result; a failure leaves the original unread cue and
offers a local retry.

**Alternatives considered**: Marking all unread items on page open, updating by
time range, re-querying in the client, or mutating during server render all
violate the Issue #513/#512 contract.

## Decision: Use shared UI and Tokyo date formatting

**Rationale**: `PageHeading`, `StatePanel`, `ListRowLink`, and the existing
`formatTokyoDateTimeJa` utility own the repository's semantics and accessibility
patterns. The unread cue will be a neutral/accent indicator plus text, not a
Badge status or destructive token.

**Alternatives considered**: New heading typography, an empty card, a new date
library, or a new Badge semantic would create competing authority.

## Decision: Treat source resolution as three distinct outcomes

**Rationale**: #512 returns `active` when an RLS-visible source row exists,
`resolved` when a successful source read returns no row, and an error result when
the source read fails. The route maps these to navigation, generic fallback, and
screen error respectively.

**Alternatives considered**: Treating any missing/failed source as resolved
would hide operational failures and mislead users.

## Decision: No extra E2E fixture framework

**Rationale**: The existing Playwright journey and local Supabase fixture helpers
are sufficient for an authenticated route smoke journey. Detailed source/error
and rendered-ID behavior belongs in deterministic unit/component tests.

**Alternatives considered**: Building a new database fixture factory or forcing
all failure modes through E2E would add fragile setup without improving the
contract evidence.
