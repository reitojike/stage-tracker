import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// No render harness exists in this repo for components like this one (see
// src/app/calendar/_components/__tests__/MySelectedDayList.test.ts for the
// same source-assertion pattern) - these guard the Issue #143 Task Contract
// regressions that matter most and are otherwise invisible to typecheck.

const source = readFileSync(
  fileURLToPath(new URL('../HomeUpcomingList.tsx', import.meta.url)),
  'utf8',
);

void test('the upcoming list never imports the legacy ticket_acquisitions boundary or renders a ticket-status badge', () => {
  assert.doesNotMatch(source, /ticketAcquisition|TicketDisplayStatus|ticketDisplayStatusLabel/);
});

void test('cancellation stays visible via the shared isEffectivelyCanceled check', () => {
  assert.match(source, /isEffectivelyCanceled\(event, occurrence\)/);
  assert.match(source, /中止/);
});

void test('an occurrence row carries event.id/occurrence.id/occurrence.startsAt into the shared occurrenceEventDetailHref helper, matching the Event Catalog exact-Occurrence navigation contract (Issue #194: shared with HomeDeadlineList rather than a local re-derivation)', () => {
  assert.match(
    source,
    /import \{ occurrenceEventDetailHref \} from '@\/domain\/catalogNavigation\.ts'/,
  );
  assert.match(
    source,
    /occurrenceEventDetailHref\(\s*event\.id,\s*occurrence\.id,\s*occurrence\.startsAt,?\s*\)/,
  );
});

void test('a personal schedule row reuses scheduleTemporalLabel rather than a bespoke period/time formatter', () => {
  assert.match(source, /scheduleTemporalLabel\(entry\.temporal\)/);
});

void test('a non-blocking schedule entry keeps the current outline vocabulary, not a new label', () => {
  assert.match(source, /!entry\.blocking[\s\S]{0,40}予定を確保しない/);
});

// --- Issue #189: shared day-role/date label authority, not a local one ---

void test('the date heading reuses the shared calendarDayRole authority and DayRoleText, never re-deriving weekday/holiday judgment locally', () => {
  assert.match(source, /import \{\s*DayRoleText\s*\} from '@\/ui\/DayRoleText'/);
  assert.match(
    source,
    /calendarDateAccessibleWeekdayLabel|calendarDateWeekdayLabel|calendarDayRole/,
  );
  assert.doesNotMatch(source, /getUTCDay|getDay\(\)/);
});

void test('the DayRoleText role and the section aria-label are both wired to group.date, not to an unrelated or swapped value', () => {
  assert.match(source, /<DayRoleText[\s\S]{0,40}role=\{calendarDayRole\(group\.date\)\}/);
  assert.match(source, /aria-label=\{calendarDateAccessibleWeekdayLabel\(group\.date\)\}/);
});
