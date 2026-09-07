import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// No render harness exists in this repo for a server component like this
// one (see src/app/tickets/_components/__tests__/TicketOpportunityRow.test.ts
// / src/app/calendar/_components/__tests__/MySelectedDayList.test.ts for the
// same source-assertion pattern) - these guard the Issue #143 Task Contract
// regressions that matter most and are otherwise invisible to typecheck.

const pageSource = readFileSync(fileURLToPath(new URL('../page.tsx', import.meta.url)), 'utf8');

void test('Home never imports the removed acquired-ticket boundary', () => {
  assert.doesNotMatch(pageSource, /listMyAcquisitions|ticketAcquisition|ticketTransfer/);
});

void test('Home never reintroduces HomeNav or a generic destination-card navigation hub', () => {
  assert.doesNotMatch(pageSource, /from ['"].*HomeNav|<HomeNav/);
});

void test('Home never reintroduces account/sign-out/Passkey content (moved to My Page, Issue #159)', () => {
  assert.doesNotMatch(pageSource, /signOut\(|<AccountSection|<PasskeySection/);
});

void test('the deadline block reuses the #144 actionability/ordering helper rather than re-deriving it', () => {
  assert.match(pageSource, /selectHomeDeadlineRows/);
});

void test('the upcoming block reuses the shared participation + personal-schedule typed reads, not a raw table query', () => {
  assert.match(pageSource, /listMyParticipations/);
  assert.match(pageSource, /listVisiblePersonalSchedule/);
  assert.doesNotMatch(pageSource, /\.from\(['"]/);
});

void test('an unauthenticated caller sees a page-level error, not a silently-empty dashboard', () => {
  assert.match(pageSource, /callerResult\.ok/);
});

void test('the deadline block resolves target Occurrences (not an empty Map), so cancellation-aggregation can see selected_occurrences targets (Issue #172 root cause B)', () => {
  assert.match(pageSource, /getOccurrencesByIds\(client, opportunityOccurrenceIds\)/);
  assert.doesNotMatch(
    pageSource,
    /buildTicketOpportunityTimelineRows\(\s*opportunitiesResult\.data,\s*eventsById,\s*new Map\(\),?\s*\)/,
  );
});

void test('Issue #194: the deadline heading row carries a "すべて見る" link to /tickets', () => {
  assert.match(pageSource, /<Link href="\/tickets" className=\{styles\.deadlineAllLink\}>/);
  assert.match(pageSource, /すべて見る ›/);
});

void test('Issue #194: a block read failure stays its own `unavailable` outcome, never collapsed into the combined empty guidance', () => {
  const fnMatch = /function renderHomeBlockPanel\([\s\S]*?\n\}/.exec(pageSource);
  assert.ok(fnMatch, 'expected a shared renderHomeBlockPanel(outcome, ...) function in page.tsx');
  const fnBody = fnMatch[0];
  const unavailableBranch = /if \(outcome\.status === 'unavailable'\) \{([\s\S]*?)\n  \}/.exec(
    fnBody,
  );
  const unavailableBody = unavailableBranch?.[1];
  assert.equal(typeof unavailableBody, 'string', 'expected an unavailable-status branch');
  // The unavailable branch must return unconditionally - bothEmpty must never
  // gate it, unlike the empty branch just below.
  assert.doesNotMatch(unavailableBody ?? '', /bothEmpty/);
  assert.match(
    fnBody,
    /if \(outcome\.status === 'empty'\) \{\s*return bothEmpty \? null : <StatePanel variant="empty" title=\{emptyTitle\}/,
  );
});

void test('Issue #194: the combined empty guidance only fires when both blocks are independently empty, not merely one', () => {
  assert.match(
    pageSource,
    /const bothEmpty = deadlineOutcome\.status === 'empty' && upcomingOutcome\.status === 'empty';/,
  );
});

void test('Issue #194: both blocks share one outcome->panel mapping (renderHomeBlockPanel), each with its own distinct empty copy', () => {
  assert.match(pageSource, /期限が近いものはありません/);
  assert.match(pageSource, /予定はありません/);
  assert.match(pageSource, /期限が近い申し込みも、直近の予定もありません/);
  assert.match(
    pageSource,
    /renderHomeBlockPanel\(\s*deadlineOutcome,\s*'申し込み期限を読み込めませんでした',\s*'期限が近いものはありません',\s*bothEmpty,?\s*\)/,
  );
  assert.match(
    pageSource,
    /renderHomeBlockPanel\(\s*upcomingOutcome,\s*'直近の予定を読み込めませんでした',\s*'予定はありません',\s*bothEmpty,?\s*\)/,
  );
});
