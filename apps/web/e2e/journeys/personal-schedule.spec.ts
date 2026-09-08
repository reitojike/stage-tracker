import { expect, test } from "@playwright/test";
import {
  createE2eAdminClient,
  deleteActor,
  provisionActor,
} from "../support/adminClient";
import { tokyoTodayDateString } from "../support/seedCatalog";
import { completeMagicLinkSignIn } from "../support/signIn";

/**
 * Personal schedule CRUD journey (Issue #380 primary journey 3): create an
 * all-day entry, open its detail, edit its title, then delete it - all
 * through the real app UI/Server Actions (`create`/`update`/
 * `deleteScheduleEntryAction`), which all redirect to `/calendar` on
 * success (`src/lib/actions/schedule/schedule-entry-actions.ts`).
 *
 * What this does *not* verify: sharing with another user, time-bounded
 * entries, or `blocking=false` - those are unit/DB-test territory (see
 * product-rules.md "Event-independent personal schedule"); this journey's
 * job is the create -> detail -> edit -> delete lifecycle itself.
 */
test("personal schedule: create, view, edit, then delete an entry", async ({
  page,
}) => {
  const admin = createE2eAdminClient();
  const actor = await provisionActor(admin, "e2e-schedule");
  const tokyoDate = tokyoTodayDateString();
  const title = `E2E個人予定-${Date.now()}`;
  const editedTitle = `${title}-編集済み`;

  try {
    await completeMagicLinkSignIn(page, actor.email);

    // Create.
    await page.goto("/schedule/new");
    await page.getByLabel("件名").fill(title);
    await page.getByLabel("開始日").fill(tokyoDate);
    await page.getByRole("button", { name: "作成する" }).click();
    await page.waitForURL(/\/calendar/);

    // Detail (navigated to via the calendar's own entry link, not a
    // constructed URL).
    await page.getByRole("link", { name: title }).click();
    await expect(
      page.getByRole("heading", { name: "予定の詳細" }),
    ).toBeVisible();
    await expect(page.getByTestId("blocking-indicator")).toContainText(
      "blocking",
    );

    // Edit.
    await page.getByRole("link", { name: "編集する" }).click();
    const titleField = page.getByLabel("件名");
    await titleField.fill(editedTitle);
    await page.getByRole("button", { name: "保存する" }).click();
    await page.waitForURL(/\/calendar/);

    // Re-open detail to confirm the edit persisted, then delete.
    await page.getByRole("link", { name: editedTitle }).click();
    await expect(
      page.getByRole("heading", { name: "予定の詳細" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "削除する" }).click();
    await page
      .getByRole("alertdialog", { name: "予定の削除の確認" })
      .getByRole("button", { name: "削除する" })
      .click();
    await page.waitForURL(/\/calendar/);

    await expect(page.getByRole("link", { name: editedTitle })).toHaveCount(0);
  } finally {
    await deleteActor(admin, actor.userId);
  }
});
