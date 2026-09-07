import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// No render harness exists in this repo for components like this one (see
// src/app/tickets/_components/__tests__/TicketOpportunityRow.test.ts for the
// same source-assertion pattern) - these guard the Issue #143 Task Contract
// regressions that matter most and are otherwise invisible to typecheck.

const source = readFileSync(
  fileURLToPath(new URL('../HomeDeadlineList.tsx', import.meta.url)),
  'utf8',
);

void test('the deadline card never re-derives actionability/red-badge logic of its own - it only formats what selectHomeDeadlineRows already filtered', () => {
  assert.doesNotMatch(source, /myState\s*===|milestoneType\s*===/);
  assert.match(source, /ticketOpportunityDeadlineBadge/);
});

void test('the deadline card never holds its own urgency threshold - it only renders the variant/label ticketOpportunityDeadlineBadge returns', () => {
  assert.doesNotMatch(source, /<=\s*3|<\s*14|days?\s*[<>]=?\s*\d/i);
});

void test('the deadline date/time reuses the #144 precision-preserving formatter, never a bespoke date string', () => {
  assert.match(source, /formatTicketOpportunityMilestoneDisplay/);
});

void test('red fill is confined to the deadline Badge - the card itself carries no red-fill styling', () => {
  assert.doesNotMatch(source, /color-danger|background.*red/i);
});

void test('the card shows the Opportunity display name alongside the Event title, so same-Event multi-opportunity rows stay distinguishable', () => {
  assert.match(source, /row\.eventTitle/);
  assert.match(source, /row\.opportunityDisplayName/);
});

void test("Issue #194: the card is now an Event-detail Link, built from the row's own eventId via the shared catalog navigation helper", () => {
  assert.match(source, /from ['"]next\/link['"]/);
  assert.match(source, /<Link\s+href=\{deadlineCardHref\(row, todayTokyoDate\)\}/);
  assert.match(source, /catalogEventHref\(row\.eventId,/);
});

void test('Issue #194: the trailing chevron only renders when the source milestone carries a time - a date-only milestone shows no chevron', () => {
  assert.match(source, /display\.timeLabel !== null \? \(\s*<span className=\{styles\.chevron\}/);
});

void test('Issue #194: deadlineCardHref picks the nearest *upcoming* target Occurrence, not simply the earliest resolved one', () => {
  // row.targetOccurrences is only chronologically sorted (see
  // ticketOpportunityTimeline.ts) - nothing constrains every target to be
  // non-past, so index 0 can be stale for a bundled application spanning
  // past and future Occurrences. The fix must filter by today before
  // picking, not take array index 0 unconditionally.
  assert.doesNotMatch(source, /targetOccurrences\[0\]/);
  assert.match(source, /row\.targetOccurrences\.find\(/);
  assert.match(source, /tokyoCalendarDateFromInstant\(occurrence\.startsAt\) >= todayTokyoDate/);
  assert.match(source, /row\.targetOccurrences\.at\(-1\)/);
});
