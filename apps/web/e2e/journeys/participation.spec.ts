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
 * Catalog -> event detail -> participation journey (Issue #380 primary
 * journey 2): open an event from `/catalog`, register "参加する" for one
 * of its occurrences, see the UI reflect it, then withdraw.
 *
 * Event/Occurrence seeding here is a deliberate, documented shortcut
 * (`../support/seedCatalog.ts`): this journey's subject is the
 * participation write, not Event creation (that is
 * `event-management.spec.ts`'s subject), so the fixture event is inserted
 * directly with the service-role client rather than through
 * `/catalog/events/new`. The participation write itself always goes
 * through the real app UI/Server Action/RLS.
 *
 * What this does *not* verify: `considering` (the other MVP status),
 * visibility (`private`/`public`), or cancellation-blocked writes - those
 * are unit/DB-test territory (see product-rules.md "Participation"); this
 * journey's job is proving the read-through-UI -> write -> re-render loop
 * for the one status a user exercises most (attending), plus withdrawal.
 */
test("participation: register attending for an occurrence, then withdraw", async ({
  page,
}) => {
  const admin = createE2eAdminClient();
  const actor = await provisionActor(admin, "e2e-participation");
  const tokyoDate = tokyoTodayDateString();
  const title = `E2E参加テスト公演-${Date.now()}`;
  const seeded = await seedEventWithOccurrence(admin, {
    ownerId: actor.userId,
    title,
    tokyoDate,
    occurrenceStartsAt: `${tokyoDate}T19:00:00+09:00`,
  });

  try {
    await completeMagicLinkSignIn(page, actor.email);

    await page.goto("/catalog");
    await page.getByRole("link", { name: title }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    const occurrenceRow = page.locator(`#occurrence-${seeded.occurrenceId}`);
    const attendButton = occurrenceRow.getByRole("button", {
      name: "参加する",
    });
    await attendButton.click();
    await expect(attendButton).toHaveAttribute("aria-pressed", "true");
    await expect(
      occurrenceRow.getByRole("button", { name: "取り消す" }),
    ).toBeVisible();

    // Persisted, not just optimistic client state: reload and re-read from
    // the server-rendered initial status.
    await page.reload();
    const reloadedRow = page.locator(`#occurrence-${seeded.occurrenceId}`);
    await expect(
      reloadedRow.getByRole("button", { name: "参加する" }),
    ).toHaveAttribute("aria-pressed", "true");

    await reloadedRow.getByRole("button", { name: "取り消す" }).click();
    await expect(
      reloadedRow.getByRole("button", { name: "取り消す" }),
    ).toHaveCount(0);

    await page.reload();
    const afterWithdrawRow = page.locator(`#occurrence-${seeded.occurrenceId}`);
    await expect(
      afterWithdrawRow.getByRole("button", { name: "取り消す" }),
    ).toHaveCount(0);
    await expect(
      afterWithdrawRow.getByRole("button", { name: "参加する" }),
    ).toHaveAttribute("aria-pressed", "false");
  } finally {
    await cleanupSeededEvent(admin, seeded.eventId);
    await deleteActor(admin, actor.userId);
  }
});
