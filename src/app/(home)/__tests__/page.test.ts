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
