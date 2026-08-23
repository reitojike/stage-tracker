# Japanese national holiday data (My Calendar)

This document is the durable record of where stage-tracker's Japanese
national holiday data comes from and how it is updated (Issue #34
Acceptance Criteria: "holiday update procedureがdurableに記録される"). The
normative _rule_ this data feeds (Saturday blue / Sunday red / holiday red,
holiday priority over Saturday, color paired with a non-color cue) is owned
by `docs/ux-ui.md`'s "Calendar weekday / Japanese holiday presentation"
section; this document only covers the data itself.

## Authority

The **only** canonical source is the Cabinet Office (内閣府) "国民の祝日に
ついて" dataset:

- CSV: <https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv>
- Published from: <https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html>

An unpublished future holiday is never guessed or computed from a rule
(equinox calculation, "N-th Monday", etc.) - see
`src/domain/japaneseHolidays.ts`'s header for how the runtime lookup itself
enforces this.

## How the data gets into the repo

`scripts/update-japanese-holidays.mjs` fetches the CSV above, decodes it
(Shift_JIS), parses it, and regenerates
`src/domain/japaneseHolidaysData.ts`, a plain generated data file (dates +
names) that is never hand-edited. The generated file records its own fetch
timestamp and the exact coverage range
(`JAPANESE_HOLIDAY_DATA_COVERAGE_START` / `_END`) that snapshot actually had
published, so a reader never has to guess how current it is.

`src/domain/japaneseHolidays.ts` is the runtime lookup over that snapshot -
pure domain logic with no network access of its own.

## Update procedure

1. From the repo root, run:

   ```sh
   npm run holidays:update
   ```

2. Review the diff to `src/domain/japaneseHolidaysData.ts` (in particular
   the new coverage end date) and commit it as a normal source change, with
   its own review per this repo's Review Protocol (Executable artifact -
   `.ts` source).
3. Re-run step 1 whenever a newly-published year needs to become available.
   The Cabinet Office has no fixed publication schedule for future years,
   so this is a manual, as-needed operation - not a scheduled/cron job this
   Task introduces.

## Coverage / staleness

A date outside the snapshot's recorded coverage range is not treated as
"confirmed not a holiday" by anything that needs to draw that distinction -
see `isWithinJapaneseHolidayDataCoverage` in
`src/domain/japaneseHolidays.ts`. My Calendar's ordinary calendar rendering
does branch on this distinction: `src/domain/calendarDayRole.ts`'s
`calendarDayRole` never reports `'holiday'` for a date outside coverage
(so it is never silently rendered as a confirmed ordinary day), and
`src/app/calendar/_components/MyMonthCalendar.tsx` shows a non-color
"祝日未確認" (holiday status unconfirmed) notice - both a per-cell badge/
aria-label and a month-level notice when the displayed month includes any
out-of-coverage date.
