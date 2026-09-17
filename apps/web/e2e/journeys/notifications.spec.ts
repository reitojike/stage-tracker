import { expect, test } from "@playwright/test";
import {
  createE2eAdminClient,
  deleteActor,
  provisionActor,
} from "../support/adminClient";
import {
  cleanupSeededEvent,
  seedEventWithOccurrence,
  tokyoTodayDateString,
} from "../support/seedCatalog";
import { completeMagicLinkSignIn } from "../support/signIn";

/**
 * Notifications MVP journey (Issue #513): a new pending Invitation is
 * surfaced in the recipient-owned inbox and its active source reaches the
 * existing Invitation response surface. Direct accept/decline remains outside
 * this screen and is covered by invitation.spec.ts.
 */
test("notifications: invitation notice opens the active invitation source", async ({
  browser,
}) => {
  const admin = createE2eAdminClient();
  const inviter = await provisionActor(admin, "e2e-notification-from");
  const invitee = await provisionActor(admin, "e2e-notification-to");
  const tokyoDate = tokyoTodayDateString();
  const title = `E2Eお知らせテスト公演-${Date.now()}`;
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
    const occurrenceRow = inviterPage.locator(
      `#occurrence-${seeded.occurrenceId}`,
    );
    await occurrenceRow.getByRole("button", { name: "変更" }).click();
    await inviterPage
      .getByRole("dialog", { name: "参加の状態" })
      .getByRole("button", { name: "参加する" })
      .click();
    await expect(
      inviterPage.getByRole("dialog", { name: "参加の状態" }),
    ).toBeHidden();

    await occurrenceRow.getByRole("button", { name: "招待する" }).click();
    await inviterPage.getByLabel("招待するメールアドレス").fill(invitee.email);
    await inviterPage.getByRole("button", { name: "送信" }).click();
    await expect(
      inviterPage.getByRole("dialog", { name: "招待する" }),
    ).toBeHidden();

    const inviteePage = await inviteeContext.newPage();
    await completeMagicLinkSignIn(inviteePage, invitee.email);
    await inviteePage.goto("/notifications");
    await expect(
      inviteePage.getByRole("heading", { name: "お知らせ" }),
    ).toBeVisible();
    const notificationLink = inviteePage.getByRole("link", {
      name: /参加への招待が届いています/,
    });
    await expect(notificationLink).toHaveAttribute(
      "href",
      "/catalog/invitations",
    );
    await expect(
      inviteePage.getByText("参加への招待が届いています"),
    ).toBeVisible();

    await notificationLink.click();
    await expect(inviteePage).toHaveURL(/\/catalog\/invitations$/);
    await expect(inviteePage.getByText(title)).toBeVisible();
    await expect(
      inviteePage.getByRole("button", { name: "参加する" }),
    ).toBeVisible();
  } finally {
    await inviterContext.close();
    await inviteeContext.close();
    await cleanupSeededEvent(admin, seeded.eventId);
    await deleteActor(admin, inviter.userId);
    await deleteActor(admin, invitee.userId);
  }
});
