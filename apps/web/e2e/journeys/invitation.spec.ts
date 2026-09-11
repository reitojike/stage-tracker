import { expect, test } from '@playwright/test';
import { createE2eAdminClient, deleteActor, provisionActor } from '../support/adminClient';
import {
  cleanupSeededEvent,
  seedEventWithOccurrence,
  tokyoTodayDateString,
} from '../support/seedCatalog';
import { completeMagicLinkSignIn } from '../support/signIn';

/**
 * Invitation journey (Issue #380 primary journey 5): an `attending` user
 * invites another authenticated user (by exact registered email,
 * product-rules.md "Authenticated-user targeting") to an occurrence, and
 * the invitee accepts through `/catalog/invitations`.
 *
 * Two separate browser contexts stand in for the two actors (inviter/
 * invitee) rather than signing in and out of one page - this mirrors how
 * the two would actually interact (separate devices/sessions) and avoids
 * this suite needing a `/sign-out` step of its own.
 *
 * Event/Occurrence seeding is the same documented shortcut as
 * `participation.spec.ts` (`../support/seedCatalog.ts`): this journey's
 * subject is invite/accept, not Event creation.
 *
 * What this does *not* verify: decline, re-invite after decline, the
 * inviter-opacity guarantee (inviter never learns which of the 3 branches
 * ran), or inviting a `considering`/no-participation user - those are
 * unit/DB-test territory (see product-rules.md "Invitation"); this
 * journey's job is the invite -> accept path a real pair of users takes
 * most often.
 */
test('invitation: an attending user invites another user, who accepts', async ({ browser }) => {
  const admin = createE2eAdminClient();
  const inviter = await provisionActor(admin, 'e2e-invite-from');
  const invitee = await provisionActor(admin, 'e2e-invite-to');
  const tokyoDate = tokyoTodayDateString();
  const title = `E2E招待テスト公演-${Date.now()}`;
  const seeded = await seedEventWithOccurrence(admin, {
    ownerId: inviter.userId,
    title,
    tokyoDate,
    occurrenceStartsAt: `${tokyoDate}T20:00:00+09:00`,
  });

  const inviterContext = await browser.newContext();
  const inviteeContext = await browser.newContext();

  try {
    const inviterPage = await inviterContext.newPage();
    await completeMagicLinkSignIn(inviterPage, inviter.email);

    await inviterPage.goto(`/catalog/events/${seeded.eventId}`);
    const occurrenceRow = inviterPage.locator(`#occurrence-${seeded.occurrenceId}`);
    await occurrenceRow.getByRole('button', { name: /参加の状態/ }).click();
    await inviterPage
      .getByRole('dialog', { name: '参加の状態' })
      .getByRole('button', { name: '参加する' })
      .click();
    await expect(inviterPage.getByRole('dialog', { name: '参加の状態' })).toBeHidden();

    await occurrenceRow.getByRole('button', { name: '招待する' }).click();
    await inviterPage.getByLabel('招待するメールアドレス').fill(invitee.email);
    await inviterPage.getByRole('button', { name: '送信' }).click();
    await expect(inviterPage.getByRole('dialog', { name: '招待する' })).toBeHidden();

    const inviteePage = await inviteeContext.newPage();
    await completeMagicLinkSignIn(inviteePage, invitee.email);

    await inviteePage.goto('/catalog/invitations');
    await expect(inviteePage.getByText(title)).toBeVisible();
    await inviteePage.getByRole('button', { name: '参加する' }).click();
    await expect(inviteePage.getByText('招待はありません')).toBeVisible();

    // Persisted: the invitee's own participation is now `attending` on the
    // same occurrence, through the same write `participation.spec.ts`
    // exercises directly (invitation acceptance is that same operation -
    // product-rules.md "Invitation" "Accept").
    await inviteePage.goto(`/catalog/events/${seeded.eventId}`);
    const inviteeOccurrenceRow = inviteePage.locator(`#occurrence-${seeded.occurrenceId}`);
    await expect(inviteeOccurrenceRow.getByRole('button', { name: '参加する' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  } finally {
    await inviterContext.close();
    await inviteeContext.close();
    await cleanupSeededEvent(admin, seeded.eventId);
    await deleteActor(admin, inviter.userId);
    await deleteActor(admin, invitee.userId);
  }
});
