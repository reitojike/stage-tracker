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
 * What this does *not* verify: time-bounded entries or `blocking=false` -
 * those are unit/DB-test territory; this journey covers only the lifecycle
 * path exercised here.
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
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByTestId("blocking-indicator")).toContainText(
      "予定を確保する",
    );

    // Edit.
    await page.getByRole("link", { name: "編集" }).click();
    const titleField = page.getByLabel("件名");
    await titleField.fill(editedTitle);
    await page.getByRole("button", { name: "保存する" }).click();
    await page.waitForURL(/\/calendar/);

    // Re-open detail to confirm the edit persisted, then delete.
    await page.getByRole("link", { name: editedTitle }).click();
    await expect(
      page.getByRole("heading", { name: editedTitle }),
    ).toBeVisible();
    await page.getByRole("button", { name: "削除する" }).click();
    const deleteDialog = page.getByRole("alertdialog", {
      name: "予定の削除の確認",
    });
    await expect(deleteDialog).toContainText(
      "共有相手からもこの予定が見えなくなります。",
    );
    await deleteDialog.getByRole("button", { name: "キャンセル" }).click();
    await expect(deleteDialog).toBeHidden();

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

/** P2b: new sharing is unavailable while registration is disabled. Existing
 * legacy grants are fixtures only; owner revoke and recipient leave remain real UI operations. */
test("personal schedule sharing: disabled creation, existing revoke and leave", async ({
  browser,
}) => {
  const admin = createE2eAdminClient();
  const owner = await provisionActor(admin, "e2e-schedule-owner");
  const recipient = await provisionActor(admin, "e2e-schedule-recipient");
  const title = `E2E共有予定-${Date.now()}`;
  const ownerContext = await browser.newContext();
  const recipientContext = await browser.newContext();
  try {
    const ownerPage = await ownerContext.newPage();
    await completeMagicLinkSignIn(ownerPage, owner.email);
    await ownerPage.goto("/schedule/new");
    await ownerPage.getByLabel("件名").fill(title);
    await ownerPage.getByLabel("開始日").fill(tokyoTodayDateString());
    await ownerPage.getByRole("button", { name: "作成する" }).click();
    await ownerPage.waitForURL(/\/calendar/);
    await ownerPage.getByRole("link", { name: title }).click();
    await expect(ownerPage).toHaveURL(/\/schedule\/[0-9a-f-]+(?:\?.*)?$/);
    const entryUrl = ownerPage.url();
    const entryId = new URL(entryUrl).pathname.split("/").at(-1) ?? "";
    if (!entryId) throw new Error("missing entry id");
    await expect(ownerPage.getByText(/新しい共有の追加は準備中/)).toBeVisible();
    await expect(ownerPage.getByRole("button", { name: "+ 追加" })).toHaveCount(
      0,
    );
    await expect(
      ownerPage.getByLabel("共有する相手のメールアドレス"),
    ).toHaveCount(0);
    await ownerPage.goto("/mypage");
    await ownerPage
      .getByRole("link", { name: "共有相手の登録", exact: true })
      .click();
    await expect(
      ownerPage.getByText("共有相手の登録は準備中です"),
    ).toBeVisible();
    await expect(
      ownerPage.getByRole("button", { name: "登録を申請する" }),
    ).toHaveCount(0);
    await expect(ownerPage.getByRole("textbox")).toHaveCount(0);
    const screenshot = test.info().outputPath("contacts-disabled.png");
    await ownerPage.screenshot({ path: screenshot, fullPage: true });
    await test.info().attach("contacts-disabled", {
      path: screenshot,
      contentType: "image/png",
    });
    async function seedLegacyShare() {
      const { error } = await admin.from("personal_schedule_shares").insert({
        schedule_entry_id: entryId,
        shared_with_user_id: recipient.userId,
      });
      if (error)
        throw new Error(`legacy fixture insert failed: ${error.message}`);
    }
    await seedLegacyShare();
    await ownerPage.goto(entryUrl);
    const remove = ownerPage.getByRole("button", {
      name: `${recipient.email}の共有を解除`,
    });
    await expect(remove).toBeVisible();
    await remove.click();
    await expect(remove).toHaveCount(0);
    await expect(ownerPage.getByRole("dialog")).toHaveCount(0);
    await seedLegacyShare();
    const recipientPage = await recipientContext.newPage();
    await completeMagicLinkSignIn(recipientPage, recipient.email);
    await recipientPage.goto("/calendar");
    await recipientPage.getByRole("link", { name: title }).click();
    await expect(
      recipientPage.getByRole("heading", { name: title }),
    ).toBeVisible();
    await expect(
      recipientPage.getByRole("button", { name: "+ 追加" }),
    ).toHaveCount(0);
    await recipientPage.getByRole("button", { name: "共有から外れる" }).click();
    await recipientPage.waitForURL(/\/calendar/);
    await expect(recipientPage.getByRole("link", { name: title })).toHaveCount(
      0,
    );
    await recipientPage.goto(entryUrl);
    await expect(
      recipientPage.getByText("この予定は見つかりませんでした"),
    ).toBeVisible();
  } finally {
    await ownerContext.close();
    await recipientContext.close();
    await deleteActor(admin, owner.userId);
    await deleteActor(admin, recipient.userId);
  }
});
