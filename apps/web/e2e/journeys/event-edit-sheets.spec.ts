import { expect, test } from "@playwright/test";
import {
  cleanupSeededEvent,
  seedEventWithOccurrence,
  tokyoTodayDateString,
} from "../support/seedCatalog";
import {
  createE2eAdminClient,
  deleteActor,
  provisionActor,
} from "../support/adminClient";
import { completeMagicLinkSignIn } from "../support/signIn";

function nextTokyoDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(
    new Date(Date.now() + 24 * 60 * 60 * 1000),
  );
}

/**
 * Event edit Sheet journey (Issue #422): exercise the Oracle-defined
 * range/occurrence/delete interactions through the real route, Server
 * Actions, shared Sheet, and local Supabase. The fixture is seeded directly
 * because this journey is scoped to the edit interactions rather than Event
 * creation (that path is covered by `event-management.spec.ts`).
 */
test("event edit: range, occurrence, deletion, and cancellation boundaries", async ({
  page,
}) => {
  const admin = createE2eAdminClient();
  const actor = await provisionActor(admin, "e2e-event-edit-sheets");
  const tokyoDate = tokyoTodayDateString();
  const title = `E2Eイベント編集Sheetテスト-${Date.now()}`;
  const seeded = await seedEventWithOccurrence(admin, {
    ownerId: actor.userId,
    title,
    tokyoDate,
    occurrenceStartsAt: `${tokyoDate}T18:30:00+09:00`,
  });

  try {
    await completeMagicLinkSignIn(page, actor.email);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`/catalog/events/${seeded.eventId}/edit`);

    // Range: open, Escape/backdrop dismiss, focus return, validation stays
    // open, then successful save closes the Sheet.
    const rangeTrigger = page.getByRole("button", {
      name: "開催期間を変更",
    });
    await rangeTrigger.focus();
    await rangeTrigger.click();
    let rangeSheet = page.getByRole("dialog", { name: "開催期間を変更" });
    await expect(rangeSheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(rangeSheet).toBeHidden();
    await expect(rangeTrigger).toBeFocused();

    await rangeTrigger.click();
    rangeSheet = page.getByRole("dialog", { name: "開催期間を変更" });
    await page
      .getByTestId("sheet-backdrop")
      .click({ position: { x: 2, y: 2 } });
    await expect(rangeSheet).toBeHidden();

    await rangeTrigger.click();
    rangeSheet = page.getByRole("dialog", { name: "開催期間を変更" });
    await rangeSheet
      .getByRole("textbox", { name: "開始日", exact: true })
      .fill(nextTokyoDate());
    await rangeSheet
      .getByRole("textbox", { name: "終了日", exact: true })
      .fill(tokyoDate);
    await rangeSheet.getByRole("button", { name: "開催期間を保存" }).click();
    await expect(rangeSheet).toBeVisible();
    await expect(rangeSheet.getByRole("alert").first()).toBeVisible();

    await rangeSheet
      .getByRole("textbox", { name: "開始日", exact: true })
      .fill(tokyoDate);
    await rangeSheet.getByRole("button", { name: "開催期間を保存" }).click();
    await expect(rangeSheet).toBeHidden();

    // Occurrence add: successful submit resets the fields while keeping the
    // Sheet open; submitting the same instant again produces visible failure
    // feedback and still keeps it open.
    const addTrigger = page.getByRole("button", { name: "＋ 公演回を追加" });
    await addTrigger.click();
    const addSheet = page.getByRole("dialog", { name: "公演回を追加" });
    const addedStartsAt = `${tokyoDate}T19:00`;
    const addStartsAt = addSheet.getByLabel(/開演日時/);
    await addStartsAt.fill(addedStartsAt);
    await addSheet.getByRole("button", { name: "公演回を追加" }).click();
    await expect(addSheet).toBeVisible();
    await expect(addStartsAt).toHaveValue("");
    await expect(addSheet.getByRole("status")).toContainText(
      "次の公演回を入力できます。",
    );

    await addStartsAt.fill(addedStartsAt);
    await addSheet.getByRole("button", { name: "公演回を追加" }).click();
    await expect(addSheet).toBeVisible();
    await expect(addSheet.getByRole("alert")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(addSheet).toBeHidden();

    // Occurrence update: success closes and refreshes the current page.
    const seededOccurrenceText = page.getByText(`${tokyoDate} 18:30`, {
      exact: true,
    });
    const seededOccurrenceRow = seededOccurrenceText
      .locator("..")
      .locator("..");
    await expect(seededOccurrenceRow).toBeVisible();
    await seededOccurrenceRow.getByRole("button", { name: "変更" }).click();
    const updateSheet = page.getByRole("dialog", { name: "公演回を変更" });
    const updatedStartsAt = `${tokyoDate}T20:00`;
    await updateSheet.getByLabel(/開演日時/).fill(updatedStartsAt);
    await updateSheet.getByRole("button", { name: "保存" }).click();
    await expect(updateSheet).toBeHidden();
    await expect(
      page.getByText(`${tokyoDate} 20:00`, { exact: true }),
    ).toBeVisible();

    // Cancellation remains a direct reversible action without a confirmation
    // Sheet. Reloads only re-read the server state; no cancellation semantics
    // are introduced by this journey.
    let occurrenceRow = page
      .getByText(`${tokyoDate} 20:00`, { exact: true })
      .locator("..")
      .locator("..");
    const cancelResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/catalog/events/${seeded.eventId}/edit`),
    );
    await occurrenceRow.getByRole("button", { name: "中止にする" }).click();
    await cancelResponse;
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    occurrenceRow = page
      .getByText(`${tokyoDate} 20:00`, { exact: true })
      .locator("..")
      .locator("..");
    await expect(
      occurrenceRow.getByRole("button", { name: "中止を解除" }),
    ).toBeVisible();
    const uncancelResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/catalog/events/${seeded.eventId}/edit`),
    );
    await occurrenceRow.getByRole("button", { name: "中止を解除" }).click();
    await uncancelResponse;
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();

    // Occurrence deletion requires an explicit Sheet. Escape refuses the
    // operation; confirmation succeeds and leaves the edit page in place.
    occurrenceRow = page
      .getByText(`${tokyoDate} 20:00`, { exact: true })
      .locator("..")
      .locator("..");
    await occurrenceRow
      .getByRole("button", { name: "この公演回を削除する" })
      .click();
    const occurrenceDeleteSheet = page.getByRole("dialog", {
      name: "この公演回を削除",
    });
    await expect(occurrenceDeleteSheet).toContainText(
      "参加・招待データが無い場合のみ削除できます。",
    );
    await page.keyboard.press("Escape");
    await expect(occurrenceDeleteSheet).toBeHidden();
    await expect(page).toHaveURL(
      new RegExp(`/catalog/events/${seeded.eventId}/edit$`),
    );

    occurrenceRow = page
      .getByText(`${tokyoDate} 20:00`, { exact: true })
      .locator("..")
      .locator("..");
    await occurrenceRow
      .getByRole("button", { name: "この公演回を削除する" })
      .click();
    await page
      .getByRole("dialog", { name: "この公演回を削除" })
      .getByRole("button", { name: "削除する" })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByText(`${tokyoDate} 20:00`, { exact: true }),
    ).toHaveCount(0);
    await expect(page).toHaveURL(
      new RegExp(`/catalog/events/${seeded.eventId}/edit$`),
    );

    // Event deletion also requires confirmation and redirects only after the
    // confirmed action succeeds.
    const eventDeleteTrigger = page.getByRole("button", {
      name: "このイベントを削除する",
    });
    await eventDeleteTrigger.click();
    const eventDeleteSheet = page.getByRole("dialog", {
      name: "このイベントを削除",
    });
    await expect(eventDeleteSheet).toContainText(
      "削除可能な公演回をまとめて削除します。",
    );
    await eventDeleteSheet.getByRole("button", { name: "キャンセル" }).click();
    await expect(eventDeleteSheet).toBeHidden();
    await expect(page).toHaveURL(
      new RegExp(`/catalog/events/${seeded.eventId}/edit$`),
    );

    await eventDeleteTrigger.click();
    await page
      .getByRole("dialog", { name: "このイベントを削除" })
      .getByRole("button", { name: "削除する" })
      .click();
    await expect(page).toHaveURL(/\/catalog$/);
  } finally {
    await cleanupSeededEvent(admin, seeded.eventId);
    await deleteActor(admin, actor.userId);
  }
});
