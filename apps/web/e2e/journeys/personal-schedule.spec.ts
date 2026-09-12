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
 * those are unit/DB-test territory (see product-rules.md
 * "Event-independent personal schedule").
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

/**
 * Personal schedule sharing journey (Issue #423): owner adds a registered
 * recipient through the shared Sheet, sees the recipient state refresh, and
 * both owner recipient-removal and recipient self-removal remain immediate
 * actions with no confirmation Sheet.
 */
test("personal schedule sharing: add through Sheet, then leave immediately", async ({
  browser,
}) => {
  const admin = createE2eAdminClient();
  const owner = await provisionActor(admin, "e2e-schedule-owner");
  const recipient = await provisionActor(admin, "e2e-schedule-recipient");
  const tokyoDate = tokyoTodayDateString();
  const title = `E2E共有予定-${Date.now()}`;
  const ownerContext = await browser.newContext();
  const recipientContext = await browser.newContext();

  try {
    const ownerPage = await ownerContext.newPage();
    await completeMagicLinkSignIn(ownerPage, owner.email);

    await ownerPage.goto("/schedule/new");
    await ownerPage.getByLabel("件名").fill(title);
    await ownerPage.getByLabel("開始日").fill(tokyoDate);
    await ownerPage.getByRole("button", { name: "作成する" }).click();
    await ownerPage.waitForURL(/\/calendar/);
    await ownerPage.getByRole("link", { name: title }).click();

    const addShare = ownerPage.getByRole("button", { name: "+ 追加" });
    await addShare.click();
    const shareSheet = ownerPage.getByRole("dialog", {
      name: "共有相手を追加",
    });
    await expect(shareSheet).toBeVisible();
    await ownerPage.keyboard.press("Escape");
    await expect(shareSheet).toBeHidden();
    await expect(addShare).toBeFocused();

    await addShare.click();
    await expect(shareSheet).toBeVisible();
    await ownerPage
      .getByTestId("sheet-backdrop")
      .click({ position: { x: 2, y: 2 } });
    await expect(shareSheet).toBeHidden();
    await expect(addShare).toBeFocused();

    await addShare.click();
    await expect(shareSheet).toBeVisible();
    const recipientEmail =
      shareSheet.getByLabel("共有する相手のメールアドレス");
    await recipientEmail.fill("not-an-email");
    await shareSheet.getByRole("button", { name: "追加する" }).click();
    await expect(shareSheet).toContainText(
      "メールアドレスの形式が正しくありません。",
    );
    await expect(recipientEmail).toHaveValue("not-an-email");

    const unregisteredEmail = `not-registered-${Date.now()}@example.test`;
    await recipientEmail.fill(unregisteredEmail);
    await shareSheet.getByRole("button", { name: "追加する" }).click();
    await expect(shareSheet).toContainText(
      "このメールアドレスは、Stage Trackerに登録されていません。",
    );
    await expect(recipientEmail).toHaveValue(unregisteredEmail);

    await recipientEmail.fill(recipient.email);
    await shareSheet.getByRole("button", { name: "追加する" }).click();
    await expect(shareSheet).toBeHidden();
    await expect(ownerPage.getByText(recipient.email)).toBeVisible();

    // Owner recipient removal remains an immediate action.
    const removeRecipient = ownerPage.getByRole("button", {
      name: `${recipient.email}の共有を解除`,
    });
    await removeRecipient.click();
    await expect(removeRecipient).toHaveCount(0);
    await expect(ownerPage.getByRole("dialog")).toHaveCount(0);

    // Re-share so the recipient can exercise the independent self-remove path.
    await addShare.click();
    const reshareSheet = ownerPage.getByRole("dialog", {
      name: "共有相手を追加",
    });
    await reshareSheet
      .getByLabel("共有する相手のメールアドレス")
      .fill(recipient.email);
    await reshareSheet.getByRole("button", { name: "追加する" }).click();
    await expect(reshareSheet).toBeHidden();

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
  } finally {
    await ownerContext.close();
    await recipientContext.close();
    await deleteActor(admin, owner.userId);
    await deleteActor(admin, recipient.userId);
  }
});
