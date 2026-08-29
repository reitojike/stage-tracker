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

void test('Home never reads the legacy ticket_acquisitions/tickets/ticket_transfers boundary', () => {
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
  assert.match(pageSource, /status === 'unavailable' \? \(\s*<StatePanel/);
});

void test('Issue #194: the combined empty guidance only fires when both blocks are independently empty, not merely one', () => {
  assert.match(
    pageSource,
    /const bothEmpty = deadlineOutcome\.status === 'empty' && upcomingOutcome\.status === 'empty';/,
  );
});

void test('Issue #194: per-block empty copy is distinct from the combined guidance copy, and each per-block panel is suppressed when both are empty', () => {
  assert.match(pageSource, /期限が近いものはありません/);
  assert.match(pageSource, /予定はありません/);
  assert.match(pageSource, /期限が近い申し込みも、直近の予定もありません/);
  assert.match(
    pageSource,
    /bothEmpty \? null : \(\s*<StatePanel variant="empty" title="期限が近いものはありません" \/>\s*\)/,
  );
  assert.match(
    pageSource,
    /bothEmpty \? null : \(\s*<StatePanel variant="empty" title="予定はありません" \/>\s*\)/,
  );
});
