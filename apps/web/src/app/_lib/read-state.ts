import {
  classifyReadResult,
  toReadErrorVariant,
  type ReadResult,
  type ReadState,
} from "@/lib/data";

/**
 * The same `empty`/`error`/`unavailable`/`populated` 4-way split as
 * `@stage-tracker/ui`'s `StatePanel`/`@/lib/data`'s `ReadState` - literally
 * an alias of it, not a re-declaration (PR #381 review finding 3: don't fork
 * the same 4-state shape into 2 independently-maintained type
 * declarations). Kept as a distinct name because a screen *block* here can
 * be backed by more than one independent `ReadResult` (e.g. home's
 * "直近の予定" block combines `listMyParticipations` +
 * `listVisiblePersonalSchedule` - `apps/web/src/lib/data/reads/home.ts`'s own
 * docstring), which `@/lib/data`'s single-read classifiers don't combine on
 * their own - the combinators below (`classifyBlock1`/`classifyBlock2Optional`/
 * `classifyMergedListBlock2`) are that screen-layer decision, kept out of
 * `apps/web/src/lib/data/` per this Task's constraint that directory must not
 * change.
 *
 * `docs/v2/decisions.md` P4 ("エラー表示は「read ごとに独立して劣化」へ統一
 * する") is a **read-granularity** decision: each independent read degrades
 * on its own, never forcing a sibling read's data to disappear because of an
 * unrelated failure. `/calendar`'s 2 fully-independent loaders
 * (`../calendar/_lib/calendar-loader.ts`) already apply this literally (2
 * separate `BlockState`s, each backed by exactly 1 read via
 * `classifyBlock1`). The combinators here extend the same P4 principle to
 * blocks whose *display* merges 2 reads into one list/aggregate - see each
 * combinator's own docstring for how independence is preserved even when the
 * reads are combined into a single `BlockState`.
 */
export type BlockState<T> = ReadState<T>;

/**
 * Shared, static, safe `StatePanel` `description` copy for the `error`
 * variant (PR #381 review finding 2). Screens own their own `title` copy
 * per `variant` already (each `*View.tsx` branches on `state.variant`
 * itself); this is only the one bit of generic retry guidance every screen
 * would otherwise repeat verbatim for `error`. Not used for `unavailable`
 * - the screen's own title copy ("...を確認できません") already conveys
 * that case without needing a generic retry hint.
 */
export const READ_FAILURE_RETRY_HINT_JA =
  "しばらくしてから再度お試しください。";

/**
 * Classifies a block backed by exactly 1 read - `T` need not be an array
 * (unlike `@/lib/data`'s `classifyListReadResult`), so this also covers a
 * block whose display shape is a transform of the raw read (e.g. a filtered/
 * sorted subset). A thin wrapper over `@/lib/data`'s `classifyReadResult` -
 * the single canonical classification primitive (PR #381 review finding 3).
 */
export function classifyBlock1<A, T>(
  a: ReadResult<A>,
  build: (a: A) => T,
  isEmpty: (data: T) => boolean,
): BlockState<T> {
  return classifyReadResult(a, build, isEmpty);
}

/**
 * Classifies a block backed by 1 **required** read and 1 **optional** read
 * that are 2 facets of the same entities (e.g. home's/`/tickets`'s "申し込み
 * 期限" block: `listTicketOpportunities` - the shared catalog rows
 * themselves - and `listMyTicketOpportunityStates` - the caller's own
 * `planned`/`applied` badge for each of those rows).
 *
 * P4 applied at read granularity here means: `required`'s failure fails the
 * whole block (there is nothing to render at all without it - see PR #381
 * review finding 1's own framing: "常に2 readが揃わないと意味が成立しない
 * block なら block 単位 fail も合理的" - this *is* that case for the
 * `required` read specifically), but `optional`'s failure degrades to
 * `optionalFallback` (typically `[]`, i.e. "no personal state" - the exact
 * same shape as a caller with 0 rows in that table) rather than hiding
 * `required`'s data. This mirrors `reads/tickets.ts`'s
 * `buildTicketOpportunityAggregates` docstring, which already documents
 * `myState` degrading to `null` per-row when no state exists for an
 * opportunity - a missing personal badge is not a reason to hide the shared
 * opportunity itself.
 */
export function classifyBlock2Optional<A, B, T>(
  required: ReadResult<A>,
  optional: ReadResult<B>,
  optionalFallback: B,
  build: (a: A, b: B) => T,
  isEmpty: (data: T) => boolean,
): BlockState<T> {
  if (!required.ok) {
    return { variant: toReadErrorVariant(required.error.kind) };
  }
  const b = optional.ok ? optional.value : optionalFallback;
  return classifyReadResult(required, (a) => build(a, b), isEmpty);
}

/**
 * Classifies a block that merges 2 independent **list** reads into one
 * displayed list (e.g. home's "直近の予定" block: `listMyParticipations` +
 * `listVisiblePersonalSchedule`, concatenated and sorted chronologically -
 * neither list is "the backbone" the way `classifyBlock2Optional`'s
 * `required` read is; each contributes its own items).
 *
 * P4 applied at read granularity here means: if exactly 1 of the 2 reads
 * fails, the block still renders using the surviving read's items alone
 * (`build` is called with the failed side's fallback treated as `[]`) rather
 * than hiding everything because of an unrelated read's failure - this is
 * the concrete fix for PR #381 review finding 1 (the block previously
 * failed outright whenever *either* read failed, contradicting both this
 * combinator's own callers' doc comments and `docs/v2/decisions.md` P4).
 * Only when *both* reads fail does the block report a failure - arbitrarily
 * but deterministically classified from `a`'s error kind, since `BlockState`
 * has no way to surface 2 independent failures at once.
 */
export function classifyMergedListBlock2<A, B, T>(
  a: ReadResult<readonly A[]>,
  b: ReadResult<readonly B[]>,
  build: (a: readonly A[], b: readonly B[]) => T,
  isEmpty: (data: T) => boolean,
): BlockState<T> {
  if (!a.ok && !b.ok) {
    return { variant: toReadErrorVariant(a.error.kind) };
  }
  const data = build(a.ok ? a.value : [], b.ok ? b.value : []);
  return isEmpty(data) ? { variant: "empty" } : { variant: "populated", data };
}
