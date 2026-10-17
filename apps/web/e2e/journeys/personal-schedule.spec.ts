import { expect, test } from "@playwright/test";
import {
  createE2eAdminClient,
  deleteActor,
  provisionActor,
  seedLegacyScheduleShare,
} from "../support/adminClient";
import { tokyoTodayDateString } from "../support/seedCatalog";
import { completeMagicLinkSignIn } from "../support/signIn";
import { readScheduleContactCapability } from "../support/scheduleContactCapability";

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

/** Phase-aware sharing journey: the disabled phase uses legacy grants only for
 * existing-share revoke/leave proof; enabled sharing uses real contact consent. */
test("personal schedule sharing: phase-aware consent, revoke, leave and unlink", async ({
  browser,
}) => {
  test.setTimeout(90_000);
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
    await ownerPage.goto("/mypage/schedule-contacts");
    const requestEmail = ownerPage.getByLabel("相手の登録メールアドレス");
    const registrationEnabled = await readScheduleContactCapability(
      ownerPage,
      owner.userId,
    );
    if (registrationEnabled) await expect(requestEmail).toBeVisible();
    if (!registrationEnabled) {
      await expect(
        ownerPage.getByText("共有相手の登録は準備中です"),
      ).toBeVisible();
      await ownerPage.goto(entryUrl);
    }
    if (registrationEnabled) {
      const recipientPage = await recipientContext.newPage();
      await completeMagicLinkSignIn(recipientPage, recipient.email);
      const recipientTitle = `E2E-reciprocal-share-${Date.now()}`;
      await recipientPage.goto("/schedule/new");
      await recipientPage.getByLabel("件名").fill(recipientTitle);
      await recipientPage.getByLabel("開始日").fill(tokyoTodayDateString());
      await recipientPage.getByRole("button", { name: "作成する" }).click();
      await recipientPage.waitForURL(/\/calendar/);
      await recipientPage.getByRole("link", { name: recipientTitle }).click();
      await expect(recipientPage).toHaveURL(/\/schedule\/[0-9a-f-]+(?:\?.*)?$/);
      const recipientEntryUrl = recipientPage.url();
      const recipientEntryId =
        new URL(recipientEntryUrl).pathname.split("/").at(-1) ?? "";
      if (!recipientEntryId) throw new Error("missing recipient entry id");

      await ownerPage.goto("/mypage/schedule-contacts");
      await ownerPage
        .getByLabel("相手の登録メールアドレス")
        .fill(recipient.email);
      await ownerPage.getByRole("button", { name: "登録を申請する" }).click();
      await expect(ownerPage.getByRole("status")).toBeVisible();
      await recipientPage.goto("/mypage/schedule-contacts");
      const accept = recipientPage.getByRole("button", {
        name: `${owner.email}からの申請を承認`,
      });
      await expect(accept).toBeVisible();
      await accept.click();
      await expect(accept).toHaveCount(0);
      await expect(
        recipientPage.getByText(owner.email, { exact: true }),
      ).toBeVisible();

      async function expectShareCount(
        scheduleEntryId: string,
        userId: string,
        count: number,
      ) {
        const { data, error } = await admin
          .from("personal_schedule_shares")
          .select("id")
          .eq("schedule_entry_id", scheduleEntryId)
          .eq("shared_with_user_id", userId);
        if (error)
          throw new Error(`share verification failed: ${error.message}`);
        expect(data).toHaveLength(count);
      }

      // Registration alone must not share either user's schedule.
      await expectShareCount(entryId, recipient.userId, 0);
      await expectShareCount(recipientEntryId, owner.userId, 0);

      async function shareOwnerEntry() {
        await ownerPage.goto(entryUrl);
        await ownerPage.getByRole("button", { name: "+ 追加" }).click();
        const dialog = ownerPage.getByRole("dialog");
        await dialog
          .getByLabel("共有する相手")
          .selectOption({ label: recipient.email });
        await dialog.getByRole("button", { name: "追加する" }).click();
        const revoke = ownerPage.getByRole("button", {
          name: `${recipient.email}の共有を解除`,
        });
        await expect(revoke).toBeVisible();
        await expectShareCount(entryId, recipient.userId, 1);
        return revoke;
      }

      const revoke = await shareOwnerEntry();
      await recipientPage.goto("/calendar");
      await recipientPage.getByRole("link", { name: title }).click();
      await expect(
        recipientPage.getByRole("heading", { name: title }),
      ).toBeVisible();
      await revoke.click();
      await expect(revoke).toHaveCount(0);
      await recipientPage.reload();
      await expect(
        recipientPage.getByRole("heading", { name: title }),
      ).toHaveCount(0);
      await expectShareCount(entryId, recipient.userId, 0);

      await shareOwnerEntry();
      await recipientPage.goto(entryUrl);
      await recipientPage
        .getByRole("button", { name: "共有から外れる" })
        .click();
      await recipientPage.waitForURL(/\/calendar/);
      await expect(
        recipientPage.getByRole("link", { name: title }),
      ).toHaveCount(0);
      await expectShareCount(entryId, recipient.userId, 0);

      // Prove unlink removes grants in both directions, then re-register and
      // verify the new relationship does not revive either old grant.
      await shareOwnerEntry();
      await recipientPage.goto(recipientEntryUrl);
      await recipientPage.getByRole("button", { name: "+ 追加" }).click();
      const reciprocalDialog = recipientPage.getByRole("dialog");
      await reciprocalDialog
        .getByLabel("共有する相手")
        .selectOption({ label: owner.email });
      await reciprocalDialog.getByRole("button", { name: "追加する" }).click();
      await expect(
        recipientPage.getByRole("button", {
          name: `${owner.email}の共有を解除`,
        }),
      ).toBeVisible();
      await expectShareCount(recipientEntryId, owner.userId, 1);
      await ownerPage.goto("/calendar");
      await expect(
        ownerPage.getByRole("link", { name: recipientTitle }),
      ).toBeVisible();

      await recipientPage.goto("/mypage/schedule-contacts");
      const unlink = recipientPage.getByRole("button", {
        name: `${owner.email}の登録を解除`,
      });
      await expect(unlink).toBeVisible();
      await unlink.click();
      await expect(
        recipientPage.getByRole("heading", {
          name: "共有相手の登録を解除しますか？",
        }),
      ).toBeVisible();
      await recipientPage
        .getByRole("button", {
          name: "登録と両方向の共有を解除する",
        })
        .click();
      await expect(
        recipientPage.getByText(owner.email, { exact: true }),
      ).toHaveCount(0);
      await expectShareCount(entryId, recipient.userId, 0);
      await expectShareCount(recipientEntryId, owner.userId, 0);
      await ownerPage.goto("/calendar");
      await expect(
        ownerPage.getByRole("link", { name: recipientTitle }),
      ).toHaveCount(0);

      await ownerPage.goto("/mypage/schedule-contacts");
      await ownerPage
        .getByLabel("相手の登録メールアドレス")
        .fill(recipient.email);
      await ownerPage.getByRole("button", { name: "登録を申請する" }).click();
      await expect(ownerPage.getByRole("status")).toBeVisible();
      await recipientPage.goto("/mypage/schedule-contacts");
      const reaccept = recipientPage.getByRole("button", {
        name: `${owner.email}からの申請を承認`,
      });
      await expect(reaccept).toBeVisible();
      await reaccept.click();
      await expect(reaccept).toHaveCount(0);
      await expect(
        recipientPage.getByText(owner.email, { exact: true }),
      ).toBeVisible();
      await expectShareCount(entryId, recipient.userId, 0);
      await expectShareCount(recipientEntryId, owner.userId, 0);
      await ownerPage.goto(entryUrl);
      await expect(
        ownerPage.getByRole("button", { name: "+ 追加" }),
      ).toBeVisible();
      await expect(
        ownerPage.getByRole("button", {
          name: `${recipient.email}の共有を解除`,
        }),
      ).toHaveCount(0);
      await recipientPage.goto("/calendar");
      await expect(
        recipientPage.getByRole("link", { name: title }),
      ).toHaveCount(0);
      await ownerPage.goto("/calendar");
      await expect(
        ownerPage.getByRole("link", { name: recipientTitle }),
      ).toHaveCount(0);
      return;
    }
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
      await seedLegacyScheduleShare(entryId, recipient.userId);
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
