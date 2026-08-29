import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// No render harness exists for this component (see MyMonthCalendar.test.ts /
// MonthCalendar.test.ts for the same source-assertion pattern this repo
// already uses in place of one), so this guards the exact regression PO
// review Finding 2 (#107) found: without occurrence.id as catalogEventHref's
// third argument, My Calendar's selected-day row silently drops exact
// Occurrence identity on the way to the shared Event detail page, even
// though the Event Catalog's own SelectedDayList carries it correctly.
const sourcePath = fileURLToPath(new URL('../MySelectedDayList.tsx', import.meta.url));

void test('the occurrence row link carries occurrence.id to catalogEventHref, matching the Event Catalog SelectedDayList exact-Occurrence navigation contract', () => {
  const source = readFileSync(sourcePath, 'utf8');
  assert.match(
    source,
    /catalogEventHref\(event\.id,\s*eventDetailContext,\s*occurrence\.id\)/,
    "MySelectedDayList must pass occurrence.id as catalogEventHref's third argument",
  );
});

// --- Issue #189: shared day-role/date label authority, not a local one ---

void test('the selected-day heading reuses the shared calendarDayRole authority and DayRoleText, never re-deriving weekday/holiday judgment locally', () => {
  const source = readFileSync(sourcePath, 'utf8');
  assert.match(source, /import \{\s*DayRoleText\s*\} from '@\/ui\/DayRoleText'/);
  assert.match(
    source,
    /calendarDateAccessibleWeekdayLabel|calendarDateWeekdayLabel|calendarDayRole/,
  );
  assert.doesNotMatch(source, /getUTCDay|getDay\(\)/);
});
