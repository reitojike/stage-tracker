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
 * `classifyBlock1`). `BlockState<T>` alone is only correct for a block backed
 * by exactly 1 read: it has no way to say "read A succeeded, read B failed"
 * without collapsing one of them. `classifyBlock2Optional` and
 * `classifyMergedListBlock2` therefore do **not** return a plain
 * `BlockState<T>` (PR #381 P4 follow-up review finding: the previous version
 * of this file did, and that is exactly how a failed read silently became
 * `empty`/lost its badge - see each combinator's own docstring below) - they
 * return a richer shape that keeps every read's `PartState` visible
 * alongside whatever data the surviving read(s) produced, so a screen can
 * render "this part failed" and "this part is really empty" as 2 distinct,
 * simultaneously-visible facts instead of one variant that can only say one
 * thing.
 */
export type BlockState<T> = ReadState<T>;

/**
 * The read-granularity status of a single read that is not, by itself, the
 * sole source of a block's `BlockState` - either because it only annotates a
 * backbone read's data (`classifyBlock2Optional`'s `optional`) or because it
 * is one of several peer reads merged into one list (`classifyMergedListBlock2`'s
 * `a`/`b`). Deliberately has no `data`/fallback field on the `ok: false`
 * branch: there is no way to read a value out of a failed `PartState` at the
 * type level, which is what closes the "a failed read is silently treated as
 * an empty/absent part" hole (this Task - PR #381 P4 follow-up). A screen
 * must look at `ok` before it can render anything for this part; it cannot
 * accidentally fall through to a default value the way `?? []` or a fallback
 * argument would let it.
 */
export type PartState =
  | { readonly ok: true }
  | { readonly ok: false; readonly variant: "unavailable" | "error" };

function classifyPart<A>(result: ReadResult<A>): PartState {
  return result.ok
    ? { ok: true }
    : { ok: false, variant: toReadErrorVariant(result.error.kind) };
}

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
 * The result of classifying a block backed by 1 **required** read and 1
 * **optional** read (`classifyBlock2Optional`). `block` is the required
 * read's own `BlockState` (built using `optionalFallback` when `optional`
 * failed, so `block.data` always renders); `optional` is that other read's
 * own `PartState`, kept **alongside** `block` rather than folded into it.
 *
 * This split is the fix for PR #381 P4 follow-up review finding 2
 * ("`classifyBlock2Optional`'s `optional` failure is indistinguishable from
 * `optional` succeeding with 0 rows - `optionalFallback` silently absorbs
 * both"): a screen reading only `block` would see identical data in "no
 * personal state exists for any row" and "the personal-state read failed",
 * because both produce the exact same fallback value. Exposing `optional`
 * separately lets a screen ask "did the optional read actually succeed?"
 * before deciding how to render a per-row annotation derived from it (e.g.
 * `/tickets`'s `myState` badge - it must render "不明", not silently omit
 * the badge, when `optional.ok` is `false`).
 */
export interface OptionalPartBlockState<T> {
  readonly block: BlockState<T>;
  readonly optional: PartState;
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
 * `required` read specifically), but `optional`'s failure degrades `block`
 * to `optionalFallback` (typically `[]`, i.e. "no personal state" - the exact
 * same shape as a caller with 0 rows in that table) rather than hiding
 * `required`'s data. This mirrors `reads/tickets.ts`'s
 * `buildTicketOpportunityAggregates` docstring, which already documents
 * `myState` degrading to `null` per-row when no state exists for an
 * opportunity - a missing personal badge is not a reason to hide the shared
 * opportunity itself.
 *
 * `optional`'s own `PartState` is always returned alongside `block` (see
 * `OptionalPartBlockState`'s docstring) - `required`'s data is never the
 * only thing this function can report, precisely so `optional`'s failure
 * cannot silently disappear into `block`'s fallback-shaped data.
 */
export function classifyBlock2Optional<A, B, T>(
  required: ReadResult<A>,
  optional: ReadResult<B>,
  optionalFallback: B,
  build: (a: A, b: B) => T,
  isEmpty: (data: T) => boolean,
): OptionalPartBlockState<T> {
  const optionalState = classifyPart(optional);
  if (!required.ok) {
    return {
      block: { variant: toReadErrorVariant(required.error.kind) },
      optional: optionalState,
    };
  }
  const b = optional.ok ? optional.value : optionalFallback;
  return {
    block: classifyReadResult(required, (a) => build(a, b), isEmpty),
    optional: optionalState,
  };
}

/**
 * The result of classifying a block that merges 2 independent **list**
 * reads (`classifyMergedListBlock2`). Extends the usual `unavailable`/
 * `error`/`empty`/`populated` 4-way split with a 5th `partial` variant for
 * exactly 1 read failing: `data` is still built from whichever read(s)
 * succeeded (so the surviving read's items keep rendering), but the variant
 * is deliberately **not** `empty`, even when the surviving read's own data
 * happens to be empty - see `classifyMergedListBlock2`'s docstring for why
 * collapsing that case into `empty` is exactly the bug this type exists to
 * prevent. `a`/`b` are the 2 reads' own `PartState`s (in the same order as
 * the arguments passed to `classifyMergedListBlock2`), so a screen can tell
 * *which* side failed and render that side's own failure copy next to the
 * surviving side's real data.
 */
export type MergedListBlockState<T> =
  | { readonly variant: "unavailable" }
  | { readonly variant: "error" }
  | { readonly variant: "empty" }
  | { readonly variant: "populated"; readonly data: T }
  | {
      readonly variant: "partial";
      readonly data: T;
      readonly a: PartState;
      readonly b: PartState;
    };

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
 *
 * When exactly 1 read fails, this reports `variant: "partial"` -
 * deliberately never `"empty"`, even if the surviving read's own data is an
 * empty array (PR #381 P4 follow-up review finding: the previous version
 * called `isEmpty` on the merged data regardless of whether both reads
 * actually succeeded, so "1 read failed + the other read genuinely returned
 * 0 rows" was indistinguishable from "both reads returned 0 rows" - a real
 * read failure disappeared into the exact same `empty` StatePanel a
 * caller would see with no failure at all). `isEmpty` is only ever called
 * when **both** reads succeed, which is the only case where "empty" is an
 * honestly-earned claim. Only when *both* reads fail does the block report a
 * failure - arbitrarily but deterministically classified from `a`'s error
 * kind, since there is no data to show at all in that case.
 */
export function classifyMergedListBlock2<A, B, T>(
  a: ReadResult<readonly A[]>,
  b: ReadResult<readonly B[]>,
  build: (a: readonly A[], b: readonly B[]) => T,
  isEmpty: (data: T) => boolean,
): MergedListBlockState<T> {
  if (!a.ok && !b.ok) {
    return { variant: toReadErrorVariant(a.error.kind) };
  }
  if (!a.ok || !b.ok) {
    const data = build(a.ok ? a.value : [], b.ok ? b.value : []);
    return {
      variant: "partial",
      data,
      a: classifyPart(a),
      b: classifyPart(b),
    };
  }
  const data = build(a.value, b.value);
  return isEmpty(data) ? { variant: "empty" } : { variant: "populated", data };
}
