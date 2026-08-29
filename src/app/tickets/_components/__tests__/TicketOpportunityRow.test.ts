import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// No render harness exists in this repo for components like this one (see
// src/app/calendar/_components/__tests__/MySelectedDayList.test.ts for the
// same source-assertion pattern) - these guard the Issue #144 Task Contract
// regressions that matter most and are otherwise invisible to typecheck.

const rowSource = readFileSync(
  fileURLToPath(new URL('../TicketOpportunityRow.tsx', import.meta.url)),
  'utf8',
);

void test('the row never imports the legacy ticket_acquisitions/tickets/ticket_transfers boundary', () => {
  assert.doesNotMatch(rowSource, /ticketAcquisition|ticketTransfer|from '.*\/ticket\.ts'/);
});

void test('the row never renders legacy outcome/inventory vocabulary', () => {
  for (const forbidden of [
    '当選',
    '落選',
    '結果待ち',
    '券種',
    'pending',
    'secured',
    'unsuccessful',
  ]) {
    assert.ok(!rowSource.includes(forbidden), `must not contain "${forbidden}"`);
  }
});

void test('the personal-state control only renders for the first row of an Opportunity', () => {
  assert.match(
    rowSource,
    /row\.isFirstRowForOpportunity\s*\?\s*\(\s*<TicketOpportunityStateControls/,
  );
});

const controlsSource = readFileSync(
  fileURLToPath(new URL('../TicketOpportunityStateControls.tsx', import.meta.url)),
  'utf8',
);

void test('the state controls module has no page-level "add" affordance for creating a shared Opportunity', () => {
  assert.doesNotMatch(
    controlsSource,
    /申し込み予定を追加|createTicketOpportunity|insertTicketOpportunity/,
  );
});

void test('the row shows a terminal 中止 badge when the whole Opportunity is effectively canceled (Issue #172 root cause B)', () => {
  assert.match(rowSource, /isTicketOpportunityRowEffectivelyCanceled/);
  assert.match(rowSource, /isCanceled \? \(\s*<Badge variant="terminal">中止<\/Badge>/);
});

void test('the row shows a terminal 受付終了 badge for bounded post-final retained history (Issue #192), deferring to 中止 when both are true', () => {
  assert.match(
    rowSource,
    /isCanceled \? \(\s*<Badge variant="terminal">中止<\/Badge>\s*\) : row\.isPostFinalRetainedHistory \? \(\s*<Badge variant="terminal">受付終了<\/Badge>/,
  );
});

void test('the row never re-derives its own deadline urgency threshold - it only renders the variant/label ticketOpportunityDeadlineBadge returns (Issue #191)', () => {
  assert.match(rowSource, /ticketOpportunityDeadlineBadge/);
  assert.doesNotMatch(rowSource, /myState\s*===|milestoneType\s*===/);
  assert.doesNotMatch(rowSource, /<=\s*3|<\s*14|days?\s*[<>]=?\s*\d/i);
});

void test('the state controls cover every required transition, including applied -> planned', () => {
  // Issue #144 Task Contract: no row -> planned, planned -> applied,
  // applied -> planned, planned/applied -> remove -> no row. A prior
  // revision of this component was missing the applied -> planned button -
  // caught only by rendering the fixture, since typecheck/lint cannot see a
  // missing JSX branch.
  assert.match(controlsSource, /myState === null[\s\S]{0,80}value="planned"/);
  assert.match(controlsSource, /myState === 'planned'[\s\S]{0,80}value="applied"/);
  assert.match(controlsSource, /myState === 'applied'[\s\S]{0,80}value="planned"/);
  assert.match(controlsSource, /myState !== null[\s\S]{0,80}value="remove"/);
});
