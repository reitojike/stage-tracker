import type { ReadError, ReadResult } from "@/lib/data";

/**
 * The same `empty`/`error`/`unavailable`/`populated` 4-way split as
 * `@stage-tracker/ui`'s `StatePanel`/`@/lib/data`'s `ReadState`, but for a
 * screen *block* that is backed by more than one independent
 * `ReadResult` (e.g. home's "直近の予定" block combines
 * `listMyParticipations` + `listVisiblePersonalSchedule` -
 * `apps/web/src/lib/data/reads/home.ts`'s own docstring).
 *
 * `apps/web/src/lib/data/read-result.ts` deliberately classifies only a
 * single read; combining N independent reads into one displayed block is a
 * screen-layer decision the read boundary explicitly leaves to callers (see
 * `reads/tickets.ts`'s `buildTicketOpportunityAggregates` docstring: "「片方
 * が失敗した場合にどう縮退表示するか」は screen 層の判断であり、この data 層
 * では決めない"). This file is that screen-layer decision, kept out of
 * `apps/web/src/lib/data/` per this Task's constraint that directory must not
 * change.
 *
 * `docs/v2/decisions.md` P4 ("エラー表示は「read ごとに独立して劣化」へ統一
 * する") is what `BlockState` exists to implement uniformly across all 4
 * screens in this Task, including `/calendar` (whose legacy behavior
 * collapsed multiple read failures into one generic panel - P4 explicitly
 * supersedes that).
 */
export type BlockState<T> =
  | { readonly variant: "unavailable"; readonly message: string }
  | { readonly variant: "error"; readonly message: string }
  | { readonly variant: "empty" }
  | { readonly variant: "populated"; readonly data: T };

/**
 * Mirrors `apps/web/src/lib/data/read-result.ts`'s private
 * `toUnavailableOrError` mapping (`unauthenticated`/`permission-denied` ->
 * `unavailable`, everything else -> `error`). Duplicated rather than
 * imported because that function is not exported and this file must not
 * modify `apps/web/src/lib/data/` to export it - see this module's own
 * header for why the duplication itself (combining reads) belongs here.
 */
function toBlockVariant(kind: ReadError["kind"]): "unavailable" | "error" {
  return kind === "failure" ? "error" : "unavailable";
}

/**
 * Classifies a block backed by exactly 1 read - `T` need not be an array
 * (unlike `@/lib/data`'s `classifyListReadResult`), so this also covers a
 * block whose display shape is a transform of the raw read (e.g. a filtered/
 * sorted subset).
 */
export function classifyBlock1<A, T>(
  a: ReadResult<A>,
  build: (a: A) => T,
  isEmpty: (data: T) => boolean,
): BlockState<T> {
  if (!a.ok) {
    return { variant: toBlockVariant(a.error.kind), message: a.error.message };
  }
  const data = build(a.value);
  return isEmpty(data) ? { variant: "empty" } : { variant: "populated", data };
}

/**
 * Classifies a block backed by 2 independent reads (e.g. home's "直近の予定"
 * block: `listMyParticipations` + `listVisiblePersonalSchedule`). If *either*
 * input failed, the block reports that failure (`a` checked before `b`) and
 * `build`/`isEmpty` are never called - a partially-failed block never
 * fabricates data from the read that did succeed. Only when both succeeded
 * does this call `build` to assemble the block's display data and `isEmpty`
 * to decide between the `empty` and `populated` variants.
 *
 * Takes the 2 `ReadResult`s directly (rather than a generic array of
 * `ReadResult<unknown>`) so `build` receives its inputs already narrowed to
 * their success types - no unsafe casts/non-null assertions at call sites.
 */
export function classifyBlock2<A, B, T>(
  a: ReadResult<A>,
  b: ReadResult<B>,
  build: (a: A, b: B) => T,
  isEmpty: (data: T) => boolean,
): BlockState<T> {
  if (!a.ok) {
    return { variant: toBlockVariant(a.error.kind), message: a.error.message };
  }
  if (!b.ok) {
    return { variant: toBlockVariant(b.error.kind), message: b.error.message };
  }
  const data = build(a.value, b.value);
  return isEmpty(data) ? { variant: "empty" } : { variant: "populated", data };
}
