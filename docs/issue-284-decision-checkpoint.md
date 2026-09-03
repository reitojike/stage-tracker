# Issue #284 decision checkpoint

この文書は Issue #284 の implementation 前に行った fresh inventory と
Decision A / B の比較を記録する checkpoint です。これは product rule の変更ではなく、
orchestrator の approval を待つための調査記録です。Decision A / B はこの commit では
適用していません。

## Fresh state

- Repository: `reitojike/stage-tracker`
- Base `main` SHA: `072d25b8dc18c3f8f84a521d0335d3e76fd86662`
- Base commit: `Cleanup: remove dead-consumer ActionRow/Surface/createSupabaseClient (Issue #283 Phase A) (#295)`
- Issue #284: OPEN, `Design consistency: 同一役割の Sheet の形と削除確認の文言を 1 つへ揃える`
- Issue #270: CLOSED (2026-09-02), Button `nowrap` contract is present on current main
- Issue #271: CLOSED (2026-09-03), shared row flex contract is present on current main
- Foundation pin: `.ai-dev-foundation/foundation-pin.json` -> `801df7c834aeef7eef559d648eafb421bc1d5e38`
- Generated `AGENTS.md` blob: `b6ba4bcb740327924ed731bc7e287b8c3996705c`
- Reviewer capability record: `.ai-dev-foundation/reviewers.json`, one required slot; Codex/OpenAI and Claude/Anthropic are required defaults, CodeRabbit is advisory
- Applicable review skills loaded: `.ai-dev-foundation/skills/review-code.md` and `.ai-dev-foundation/skills/review-doc.md`
- Open PRs at inventory time: none; changed-file overlap: none
- Issue #294 is OPEN and was not changed or treated as a dependency

## Fresh Sheet inventory

Current `origin/main` has 10 direct `Sheet` consumers. Eight use the footer shape with
`showCloseButton={false}`; two do not use a footer and retain the shared default close button.

| consumer | title | body / primary action | footer | close | pending / result | write path |
| --- | --- | --- | --- | --- | --- | --- |
| `InviteSheet` | `招待する` | occurrence context, email input, body submit | no | default `true` | submit disables input/button; `WriteNotice` on success closes; `StatePanel` keeps errors visible | `inviteToOccurrenceAction` |
| `ShareAddSheet` | `共有相手を追加` | `ShareAddForm` owns the email input and feedback | yes, submit is associated with body form by `formId` | `false` | submit disables the control; notice closes the sheet on success; form feedback remains on error | `addScheduleShareByEmailAction` |
| `ParticipationSheet` | `参加の状態` | vertical choice rows; each choice saves immediately; no submit control | no | default `true` | selected choice disables rows while pending; success notice is announced before close; `StatePanel` remains on error | `setParticipationChoiceAction` |
| `DeleteEventForm` | `このイベントを削除` | confirmation copy in body; danger submit | yes | `false` | `削除` -> `削除中…`; action feedback is outside the sheet; success redirects to `/catalog` | `deleteEventAction` |
| `DeleteOccurrenceForm` | `この公演回を削除` | confirmation copy in body; danger submit | yes | `false` | `削除` -> `削除中…`; parent owns feedback state | `deleteEventOccurrenceAction` |
| `DeleteEntryForm` | `削除` | confirmation copy in body; danger submit | yes | `false` | `削除` -> `削除中…`; action feedback is outside the sheet; success redirects to `/calendar` | `deleteScheduleEntryAction` |
| `EventRangeEditForm` | `開催期間` | event range form with footer save | yes | `false` | save is disabled and changes to `保存中…`; success closes through write notice | `updateEventRangeAction` |
| `FilterSheet` | `絞り込み` | genre/facet selection; footer clear + confirm | yes | `false` | confirm applies draft and closes; Escape/backdrop delegate to `Sheet` | local selection / apply callback |
| `OccurrenceAddForm` | `公演回を追加` | occurrence form with footer add | yes | `false` | add is disabled and changes to `追加中…`; success closes through write notice | `addOccurrenceAction` |
| `OccurrenceUpdateForm` | dynamic occurrence label | occurrence form and lifecycle area with footer save | yes | `false` | save is disabled and changes to `保存中…`; lifecycle feedback remains composed below | `updateOccurrenceAction` |

All consumers use the unchanged `src/ui/Sheet.tsx` primitive. Its current native
`<dialog>` path owns `showModal()` / `close()`, routes header close, backdrop, and Escape
through the same close event, and renders `footer` outside the scrollable body. The shared
primitive therefore supplies the same keyboard and modal-focus behavior to both shapes; the
current source/tests do not add a separate consumer focus implementation.

Relevant current evidence:

- `src/ui/__tests__/Sheet.test.ts:22-90` covers dialog lifecycle, backdrop, Escape, footer placement,
  and the default close behavior of `InviteSheet` / `ParticipationSheet`.
- `src/app/catalog/_components/__tests__/FinishingTouches.test.ts:94-142` covers delete footer
  composition and `ShareAddSheet`'s footer submit/form association.
- `src/app/catalog/_components/__tests__/FilterSheet.test.ts` covers the filter footer and
  dismissal delegation.
- The repository's unit tests run on plain Node without jsdom/React Testing Library, so direct
  browser interaction and 390px clipping/focus evidence remains a post-approval verification item.

## Decision A — canonical shape for a single-input Sheet

The same-role peers are split 1:1: `InviteSheet` is body-submit + visible close, while
`ShareAddSheet` is footer-submit + no header close. The broader current Sheet inventory is
8 footer/no-close consumers versus 2 no-footer/default-close consumers, but
`ParticipationSheet` is not a submit-sheet peer because it performs an immediate choice.

### Option A: body submit + close

- Matches the current `InviteSheet` implementation and keeps the primary action adjacent to
  the one input.
- Provides an explicit visible cancel/close affordance, in addition to Escape and backdrop.
- Has a small change cost for `InviteSheet`, but would leave it inconsistent with
  `ShareAddSheet`, every footer write/delete consumer, and the existing `docs/ux-ui.md` rule.
- The action remains inside the scrollable body rather than in the reachable footer slot;
  this is less robust as a form grows or the viewport becomes narrow.

### Option B: footer submit + `showCloseButton={false}`

- Matches `ShareAddSheet`, the other six footer-based non-delete write consumers, all three
  delete confirmation Sheets, and the current reusable rule in `docs/ux-ui.md`.
- Keeps the primary action outside the scroll region, right-aligned with the existing footer
  vocabulary, and reachable on short/narrow viewports.
- Removes the duplicate visible close action; Escape and backdrop remain cancellation paths,
  which is the documented confirmation/write-sheet convention.
- Requires a bounded consumer-only change to `InviteSheet` and its action CSS/tests; the
  `Sheet` API and server action do not need to change.

### Recommendation

Adopt Option B for submit-based single-input Sheets. It resolves the peer mismatch with the
smallest semantic blast radius, agrees with the current repository majority and existing
normative UX rule, and gives future submit Sheets one stable placement/close contract.

`ParticipationSheet` should remain outside this submit-shape convergence. It has no submit
button by design: a choice is saved immediately, pending disables the choice rows, and the
visible close action is useful for dismissing without selecting. It should retain its current
body choice rows and default close behavior unless a separate product decision changes its
immediate-choice semantics.

## Decision B — delete confirmation Sheet title

| target | current title | current body target context | current accessible context |
| --- | --- | --- | --- |
| event | `このイベントを削除` | event and all occurrences | Sheet title and trigger aria-label are target-specific |
| occurrence | `この公演回を削除` | one occurrence | Sheet title and trigger aria-label are target-specific |
| personal entry | `削除` | personal entry and shared recipients | surrounding page heading is `この予定を削除`, but the Sheet accessible title is generic and the trigger has no target-specific aria-label |

### Target-specific titles

Use `このイベントを削除`, `この公演回を削除`, and `この予定を削除`. This keeps the
confirmation's accessible name self-describing when the modal is considered independently
from the underlying page, preserves the existing distinction between event/occurrence/entry,
and makes the current body copy and title say the same target. It does not apply the short
contextual button-label rule from Issue #272: a Sheet title is the dialog heading, not the
danger action button label.

### Generic title

Use `削除` for all three. This is short, but loses target identity in the dialog heading and
would rely on the underlying page context that may not be the context exposed first to keyboard
or assistive-technology users. It also discards useful specificity already present in two
current titles without simplifying the confirmation body.

### Recommendation

Adopt target-specific titles. Keep all existing confirmation bodies, danger action labels,
target IDs, pending/success/error behavior, server actions, and domain semantics unchanged.
The only expected copy change under this recommendation is `DeleteEntryForm`'s Sheet title
from `削除` to `この予定を削除`; the other two titles already match the recommended rule.

## Planned artifact set after approval

The final implementation is expected to be bounded to the following current artifacts, subject
to the approved choices:

- `src/app/catalog/_components/InviteSheet.tsx`
- `src/app/catalog/_components/InviteSheet.module.css`
- `src/app/schedule/_components/DeleteEntryForm.tsx`
- affected existing tests, primarily `src/app/catalog/_components/__tests__/FinishingTouches.test.ts`
  and `src/ui/__tests__/Sheet.test.ts`
- `docs/ux-ui.md`
- `docs/screens.md`

`src/ui/Sheet.tsx`, `Button`, row flex styles, server actions, domain feedback, and
`ParticipationSheet` are not planned for semantic changes. Browser verification at 390px and
the repository verification commands are post-approval work.

## Checkpoint fence

- Decision A: recommended Option B, **not applied**.
- Decision B: recommended target-specific titles, **not applied**.
- No user-facing structure or copy was changed in this checkpoint.
- No formal review was started.
- Orchestrator approval is required before implementation continues.
