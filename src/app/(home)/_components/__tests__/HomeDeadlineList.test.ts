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
