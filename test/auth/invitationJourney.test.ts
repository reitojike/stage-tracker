import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createEventWithOccurrence, eventFixtureTitle } from '../rls/support/eventFixtures.ts';
import { createTestActor, type TestActor } from '../rls/support/testActors.ts';
import { startAppServer, type AppServer } from './support/appServer.ts';
import {
  inviteFromOccurrence,
  occurrenceRow,
  occurrenceSheet,
  readParticipationStatus,
  setParticipation,
} from './support/eventDetailDriver.ts';
import {
  assertNoHorizontalOverflow,
  clickWhenInteractive,
  createJourneyActor,
  runJourneyTeardown,
  waitUntilGone,
  type JourneyActor,
} from './support/journeyActor.ts';

// Issue #278 journey 2 of 5: **invitation**.
//
// Covers the pending-only Invitation model end to end (Issue #225/#230,
// which supersedes #30's auto-considering and permanent-decline
// semantics): an attending inviter targets an invitee by exact registered
// email, the invitee sees a pending card, declining resolves it, a
// re-invite is allowed afterwards, and reaching `attending` through the
// *ordinary* participation UI converges the pending invitation too
// (generic attending convergence). The negative case is inviter opacity -
// the one property of this feature a user cannot verify for themselves,
// and the one whose failure mode is silent.
//
// Two users means two browsers - see createJourneyActor's own header for
// why they cannot share one. Fixture dates live in 2092, a year no other
// test file's fixtures use.

const FIXTURE_MONTH = '2092-04';
const OCCURRENCE_STARTS_AT = '2092-04-08T10:00:00.000Z'; // 2092-04-08 19:00 JST

let app: AppServer;
/** The inviter. Eligibility to invite comes from being `attending` on the
 * occurrence itself - never from event ownership, and never from
 * `considering` (product-rules.md "Invitation"). This actor deliberately
 * does not own the fixture event, so the journey proves that. */
let inviter: JourneyActor;
let invitee: JourneyActor;
let owner: TestActor;
let eventId: string;
let eventTitle: string;
let occurrenceId: string;

const createdUserIds: string[] = [];
const createdActors: TestActor[] = [];
const initializedCleanups: Array<() => Promise<void>> = [];

async function seedEvent(): Promise<void> {
  owner = await createTestActor('invitation-journey-owner', 'Str0ng-Test-Passw0rd!', {
    designatedCatalogCreator: true,
  });
  createdActors.push(owner);

  eventTitle = eventFixtureTitle();
  const { event, occurrence } = await createEventWithOccurrence(owner, {
    title: eventTitle,
    startsAt: OCCURRENCE_STARTS_AT,
  });
  eventId = event.id;
  occurrenceId = occurrence.id;
}

before(async () => {
  app = await startAppServer();
  initializedCleanups.push(() => app.stop());
  await seedEvent();
  inviter = await createJourneyActor(app, { emailPrefix: 'invitation-journey-inviter' }, (id) => {
    createdUserIds.push(id);
  });
  initializedCleanups.push(() => inviter.close());
  invitee = await createJourneyActor(app, { emailPrefix: 'invitation-journey-invitee' }, (id) => {
    createdUserIds.push(id);
  });
  initializedCleanups.push(() => invitee.close());
});

after(async () => {
  await runJourneyTeardown({
    resources: initializedCleanups,
    journeyUserIds: createdUserIds,
    fixtureActors: createdActors,
  });
});

const eventDetailPath = () => `/catalog/events/${eventId}?month=${FIXTURE_MONTH}`;

/** One pending invitation card on /catalog/invitations, identified by the
 * Event title it names. Scoped to `main` so PrimaryNav's own list items
 * (outside AppShell's `<main>`) can never be mistaken for cards. */
function invitationCard(actor: JourneyActor) {
  return actor.page.locator('main li').filter({ hasText: eventTitle });
}

/** Loads the actor's own invitation list and reports whether this
 * journey's Event is currently pending there. */
async function hasPendingInvitation(actor: JourneyActor): Promise<boolean> {
  await actor.goto('/catalog/invitations');
  return (await invitationCard(actor).count()) > 0;
}

/**
 * Polls the invitation list until this journey's Event is no longer
 * pending there.
 *
 * Needed only after a decline: finalizing one is deliberately
 * fire-and-forget from InvitationCard's unmount effect (there is no UI
 * left to report to once the screen is gone), so the server write is
 * genuinely still in flight when the next screen renders. Polling is the
 * honest way to express "it resolves shortly", and a decline that never
 * reaches the server still fails here on the deadline.
 */
async function waitForNoPendingInvitation(actor: JourneyActor, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!(await hasPendingInvitation(actor))) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `the invitation for ${eventTitle} was still pending ${String(timeoutMs)}ms after declining it`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

void test('an attending user invites by exact email, and the invitee gets a pending invitation without becoming a participant', async () => {
  await inviter.goto(eventDetailPath());

  // Invite eligibility is `attending`, not `considering` - so the invite
  // affordance must not be reachable yet.
  await setParticipation(inviter, occurrenceId, '気になる');
  assert.equal(
    await occurrenceRow(inviter, occurrenceId)
      .getByRole('button', { name: '招待', exact: true })
      .count(),
    0,
    'expected no invite affordance while only 気になる',
  );

  await setParticipation(inviter, occurrenceId, '参加する');
  const inviteButton = occurrenceRow(inviter, occurrenceId).getByRole('button', {
    name: '招待',
    exact: true,
  });
  await assert.doesNotReject(
    inviteButton.waitFor({ state: 'visible', timeout: 10_000 }),
    'expected the invite affordance once attending',
  );

  // 390px smartphone-first invariant (Issue #278), asserted with the invite
  // sheet open: a full-width email field inside a bottom sheet is exactly
  // the shape a stray fixed width overflows.
  const inviteSheet = occurrenceSheet(inviter, occurrenceId, '招待する');
  await clickWhenInteractive(
    inviteButton,
    inviteSheet,
    'opening the invite sheet for the overflow check',
  );
  await assertNoHorizontalOverflow(
    inviter.page,
    'the Event detail page with the invite sheet open',
  );
  // Escape is one of Sheet's three dismissal paths (src/ui/Sheet.tsx) and
  // commits nothing, leaving the real invite below to be the first one.
  await inviter.page.keyboard.press('Escape');
  await waitUntilGone(inviteSheet);

  await inviteFromOccurrence(inviter, occurrenceId, invitee.email);

  assert.ok(
    await hasPendingInvitation(invitee),
    `expected a pending invitation for ${eventTitle} on the invitee's list`,
  );
  await assertNoHorizontalOverflow(invitee.page, 'the invitation list');

  // Pending, not accepted: being invited never creates or changes the
  // invitee's own participation (Issue #225/#230 - the old auto-considering
  // behavior is gone).
  await invitee.goto(eventDetailPath());
  assert.equal(
    await readParticipationStatus(invitee, occurrenceId),
    null,
    'expected the invitation itself not to have made the invitee a participant',
  );
});

void test('declining resolves the invitation, and the same invitee can be invited again afterwards', async () => {
  await invitee.goto('/catalog/invitations');

  // "参加しない" opens an 8-second client-local undo window; the server call
  // happens only once that window elapses *or the screen is left*
  // (InvitationCard.tsx's unmount effect). Leaving is the faster of the
  // two and is itself part of the specified behavior, so this drives that
  // path.
  await clickWhenInteractive(
    invitationCard(invitee).getByRole('button', { name: '参加しない', exact: true }),
    invitee.page.getByText('参加しないにしました'),
    'declining the invitation',
  );

  // Leaving must be a *client-side* navigation - the screen's own BackLink,
  // which is what a user taps. A full page load (actor.goto) would tear the
  // JS context down without ever running React's unmount cleanup, so the
  // decline would never be finalized and this would look like a product
  // bug rather than the wrong kind of navigation.
  await invitee.page.getByRole('link', { name: 'カレンダーに戻る' }).click();
  await invitee.page.waitForURL(/\/catalog(\?|$)/, { timeout: 20_000 });

  await waitForNoPendingInvitation(invitee);
  // Declining is a response to the invitation, not a participation
  // decision: it must leave the invitee's own (absent) participation alone
  // rather than writing a "not attending" of any kind.
  await invitee.goto(eventDetailPath());
  assert.equal(await readParticipationStatus(invitee, occurrenceId), null);

  // A past decline is not a permanent opt-out (product-rules.md
  // "Re-invite"), which is precisely what #30's original semantics got
  // wrong: the same inviter may invite the same invitee again.
  await inviter.goto(eventDetailPath());
  await inviteFromOccurrence(inviter, occurrenceId, invitee.email);
  assert.ok(await hasPendingInvitation(invitee), 'expected the re-invitation to be pending');
});

void test('reaching attending through the ordinary participation UI converges the pending invitation', async () => {
  // Generic attending convergence (product-rules.md "Invitation"): the
  // invitee never touches the invitation card. They go to Event detail and
  // choose 参加する like any other user, and the DB trigger
  // (occurrence_participations_resolve_invitations_on_attending) resolves
  // the still-pending invitation as a side effect of that same write.
  await invitee.goto(eventDetailPath());
  await setParticipation(invitee, occurrenceId, '参加する');

  assert.equal(
    await hasPendingInvitation(invitee),
    false,
    'expected becoming attending to converge the pending invitation',
  );
});

// --- Negative case: inviter opacity ---
//
// The guard is the invitee-only read on occurrence_invitations
// (`occurrence_invitations_select_own`), surfaced through
// listMyReceivedInvitations. product-rules.md: "invitation record の通常
// read は invitee 本人に限定します。inviter は、自分が作成した invitation
// であっても、通常 read で対象 invitee 向けの invitation row の有無を確認
// できません". Row visibility is what the whole opacity contract rests on -
// an inviter who could see the row could infer the invitee's private
// participation state from whether one exists at all.
void test('the inviter can observe neither the invitation they sent nor whether the address has an account', async () => {
  // Put a genuinely pending invitation back in place first (the previous
  // test converged the last one), so this proves the inviter cannot see an
  // invitation that really does exist.
  await invitee.goto(eventDetailPath());
  await setParticipation(invitee, occurrenceId, '参加をやめる');
  await inviter.goto(eventDetailPath());
  await inviteFromOccurrence(inviter, occurrenceId, invitee.email);
  assert.ok(
    await hasPendingInvitation(invitee),
    'expected a pending invitation to exist while the inviter looks',
  );

  assert.equal(
    await hasPendingInvitation(inviter),
    false,
    'expected the inviter to see no trace of the invitation they sent',
  );

  // The same opacity covers the invite operation's own outcome: an address
  // with no account behind it must be indistinguishable from a real
  // invitee, or "does this person have an account" becomes answerable from
  // the UI. inviteFromOccurrence returns only when the sheet closes, which
  // InviteSheet does on success and never on a rejected submission - so
  // this completing at all *is* the assertion.
  await inviter.goto(eventDetailPath());
  await inviteFromOccurrence(
    inviter,
    occurrenceId,
    `no-such-account-${String(Date.now())}@example.test`,
  );
});
