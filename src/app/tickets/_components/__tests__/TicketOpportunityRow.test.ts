import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// No render harness exists in this repo for components like this one (see
// src/app/calendar/_components/__tests__/MySelectedDayList.test.ts for the
// same source-assertion pattern) - these guard the Issue #144/#197 Task
// Contract regressions that matter most and are otherwise invisible to
// typecheck.

const rowSource = readFileSync(
  fileURLToPath(new URL('../TicketOpportunityRow.tsx', import.meta.url)),
  'utf8',
);
const rowCss = readFileSync(
  fileURLToPath(new URL('../TicketOpportunityRow.module.css', import.meta.url)),
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
    /row\.isFirstRowForOpportunity\s*&&[\s\S]{0,60}\?\s*\(\s*<TicketOpportunityStateControls/,
  );
});

void test('the personal-state control never renders on a bounded post-final retained history row (Issue #192) - its application window has already closed', () => {
  assert.match(
    rowSource,
    /row\.isFirstRowForOpportunity\s*&&\s*!row\.isPostFinalRetainedHistory\s*\?\s*\(\s*<TicketOpportunityStateControls/,
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

// --- Issue #197: "State Badge — max one" precedence ---

void test('the row computes at most one state-style Badge, in the precedence order Issue #197 defines', () => {
  const fn = /function ticketOpportunityRowStateBadge[\s\S]*?\n}/.exec(rowSource)?.[0];
  assert.ok(fn, 'expected a ticketOpportunityRowStateBadge function');
  const body = fn;

  const isCanceledIndex = body.indexOf('if (isCanceled)');
  const retainedIndex = body.indexOf('row.isPostFinalRetainedHistory');
  const myStateIndex = body.indexOf('row.myState !== null');
  assert.ok(isCanceledIndex >= 0 && retainedIndex >= 0 && myStateIndex >= 0);
  assert.ok(
    isCanceledIndex < retainedIndex && retainedIndex < myStateIndex,
    'cancellation must be checked before retention, which must be checked before personal state',
  );

  assert.match(body, /isCanceled\)\s*\{\s*return \{ variant: 'terminal', label: '中止' \};/);
  assert.match(
    body,
    /row\.isPostFinalRetainedHistory\)\s*\{\s*return \{ variant: 'terminal', label: '受付終了' \};/,
  );
});

void test('the row renders exactly one Badge in .badgeRow, driven by the precedence function - never one Badge per condition', () => {
  assert.doesNotMatch(rowSource, /<Badge variant="terminal">中止<\/Badge>/);
  assert.doesNotMatch(rowSource, /<Badge variant="terminal">受付終了<\/Badge>/);
  assert.match(rowSource, /styles\.badgeRow[\s\S]{0,20}>\s*<Badge variant=\{stateBadge\.variant\}/);
});

void test('applied maps to the done Badge variant, planned to subtle (Issue #197 supersedes #138)', () => {
  assert.match(rowSource, /ticketOpportunityStateBadgeVariant\(row\.myState\)/);
});

void test('the row never re-derives its own deadline urgency threshold - it only renders the variant/label ticketOpportunityDeadlineBadge returns (Issue #191)', () => {
  assert.match(rowSource, /ticketOpportunityDeadlineBadge/);
  assert.doesNotMatch(rowSource, /myState\s*===|milestoneType\s*===/);
  assert.doesNotMatch(rowSource, /<=\s*3|<\s*14|days?\s*[<>]=?\s*\d/i);
});

void test('a bounded post-final retained history row never also queries ticketOpportunityDeadlineBadge (Issue #191/#192 integration) - would otherwise duplicate 受付終了 for a planned application_close row', () => {
  assert.match(
    rowSource,
    /const deadlineBadge = row\.isPostFinalRetainedHistory\s*\?\s*null\s*:\s*ticketOpportunityDeadlineBadge\(row, todayTokyoDate\);/,
  );
});

// --- Issue #197: date column composition ---

void test("the date column reuses the shared DayRoleText color primitive and the formatting module's own role, rather than a local role/color mapping", () => {
  assert.match(rowSource, /import \{ DayRoleText \} from '@\/ui\/DayRoleText'/);
  assert.match(rowSource, /<DayRoleText[\s\S]{0,80}role=\{display\.role\}/);
  assert.doesNotMatch(rowSource, /role === 'holiday'|role === 'saturday'|role === 'sunday'/);
});

void test('the date column width is 7.1em (Issue #189: full-width parentheses no longer clip at the old 6.5em)', () => {
  assert.match(rowCss, /\.dateColumn\s*\{[\s\S]*?width:\s*7\.1em;/);
});

void test('the milestone type label renders as plain date-column text, not a Badge (Issue #197: "milestone nameをBadge rowから外す")', () => {
  assert.match(
    rowSource,
    /<p className=\{styles\.milestoneLabel\}>\s*\{ticketOpportunityMilestoneTypeLabel\(row\.milestoneType\)\}\s*<\/p>/,
  );
  assert.doesNotMatch(rowSource, /<Badge[^>]*>\{ticketOpportunityMilestoneTypeLabel/);
});

void test('the #191 deadline badge renders in the date column, not the body badge row', () => {
  const dateColumnMatch = /<div className=\{styles\.dateColumn\}>[\s\S]*?<\/div>/.exec(rowSource);
  assert.ok(dateColumnMatch);
  assert.match(dateColumnMatch[0], /deadlineBadge !== null/);
});

// --- Issue #197: body composition ---

void test('the compact secondary line composes only the existing source-backed opportunityDisplayName/eventVenue fields, never a new ticket-type concept', () => {
  assert.match(
    rowSource,
    /row\.eventVenue.*row\.opportunityDisplayName|row\.opportunityDisplayName/,
  );
  assert.doesNotMatch(rowSource, /ticketType|ticket_type/i);
});

void test('the selected-occurrences target summary only renders for selected_occurrences, never event_wide (Issue #197)', () => {
  assert.match(
    rowSource,
    /row\.targetScope === 'selected_occurrences'\s*\?\s*\(\s*<p className=\{styles\.scopeSummary\}>\{ticketOpportunityTargetScopeSummaryLabel\(row\)\}<\/p>/,
  );
});

// --- Issue #197: whole-row link / nested-interactive avoidance ---

void test('the row has exactly one whole-row Link element, absolutely positioned over the row rather than wrapping the visible content', () => {
  const linkMatches = rowSource.match(/<Link\b/g) ?? [];
  assert.equal(linkMatches.length, 1, 'expected exactly one Link element');
  assert.match(
    rowSource,
    /<Link href=\{ticketOpportunityRowEventHref\(row\)\} className=\{styles\.rowLink\}>/,
  );
  assert.match(rowCss, /\.rowLink\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;/);
  assert.match(rowCss, /\.row\s*\{[\s\S]*?position:\s*relative;/);
});

void test('the state controls form and the official-source link are never nested inside the whole-row Link (invalid interactive-in-interactive HTML)', () => {
  const linkOpen = rowSource.indexOf('<Link ');
  const linkClose = rowSource.indexOf('</Link>');
  assert.ok(linkOpen >= 0 && linkClose > linkOpen);
  const insideLink = rowSource.slice(linkOpen, linkClose);
  assert.doesNotMatch(insideLink, /TicketOpportunityStateControls|sourceLink/);
});

void test('the actions wrapper (state controls + source link) is elevated above the stretched row-link overlay via position/z-index', () => {
  assert.match(rowCss, /\.actions\s*\{[\s\S]*?position:\s*relative;[\s\S]*?z-index:\s*1;/);
  assert.match(rowSource, /<div className=\{styles\.actions\}>/);
});

void test('the row-link has an accessible name via visually-hidden text, not by wrapping the visible title (avoids double announcement)', () => {
  assert.match(rowSource, /<span className=\{styles\.srOnly\}>\{row\.eventTitle\}/);
  assert.match(rowCss, /\.srOnly\s*\{[\s\S]*?clip-path:\s*inset\(50%\);/);
});

// --- Issue #197: official source reachability preserved ---

void test('the official source link capability is preserved (never silently dropped)', () => {
  assert.match(rowSource, /row\.sourceUrl !== null && isRenderableHttpUrl\(row\.sourceUrl\)/);
  assert.match(rowSource, />\s*公式情報\s*</);
});

// --- Issue #227: chevron semantic token convergence ---

void test('the trailing chevron consumes the shared semantic icon-affordance token, never the raw neutral primitive directly', () => {
  assert.match(rowCss, /\.chevron\s*\{[\s\S]*?color:\s*var\(--color-icon-affordance\);/);
  assert.doesNotMatch(rowCss, /\.chevron\s*\{[\s\S]*?color:\s*var\(--color-neutral-500\);/);
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
