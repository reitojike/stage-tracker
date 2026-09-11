import { expect, test, type BrowserContext } from "@playwright/test";
import {
  createE2eAdminClient,
  deleteActor,
  grantCatalogCreator,
  provisionActor,
} from "../support/adminClient";
import { tokyoTodayDateString } from "../support/seedCatalog";
import { completeMagicLinkSignIn } from "../support/signIn";

/**
 * Event create/edit journey (Issue #380 primary journey 4): as a
 * designated catalog creator (product-rules.md "MVP Event catalog write
 * boundary"), create a 0-occurrence Event through `/catalog/events/new`
 * (the real `create_event` RPC), then edit its details through
 * `/catalog/events/[eventId]/edit`.
 *
 * `grantCatalogCreator` mirrors what
 * `apps/legacy-web/scripts/grant-catalog-creator.mjs` does operationally
 * (an upsert into `public.catalog_creators`) - membership itself is
 * environment data, never a hard-coded user id, and this journey grants it
 * to its own throwaway actor rather than depending on a fixed "the admin
 * account" existing in whatever environment runs this suite.
 *
 * What this does *not* verify: cancel/uncancel, occurrence add/edit/
 * delete, or the "only designated creators may create" permission
 * boundary itself (that belongs to DB/RLS tests, not a UI journey); this
 * journey's job is the create -> edit lifecycle a real catalog creator
 * exercises.
 */
test("event management: a designated catalog creator creates and edits an event", async ({
  browser,
  page,
}) => {
  const admin = createE2eAdminClient();
  const actor = await provisionActor(admin, "e2e-event-mgmt");
  await grantCatalogCreator(admin, actor.userId);
  const tokyoDate = tokyoTodayDateString();
  const title = `E2Eイベント作成テスト-${Date.now()}`;
  const editedTitle = `${title}-編集済み`;
  let eventId: string | null = null;
  let viewerUserId: string | null = null;
  let viewerContext: BrowserContext | null = null;

  try {
    await completeMagicLinkSignIn(page, actor.email);

    // Create (occurrence-less: product-rules.md "Event と公演回" allows a
    // 0-occurrence Event, so this journey leaves the occurrence fields
    // blank rather than duplicating `participation.spec.ts`'s occurrence
    // setup).
    await page.goto("/catalog/events/new");
    await page.getByLabel("タイトル").fill(title);
    await page.getByLabel("開始日").fill(tokyoDate);
    await page.getByLabel("終了日").fill(tokyoDate);
    await page.getByRole("button", { name: "作成する" }).click();

    // Not just `/\/catalog\/events\/[^/]+$/` - that pattern also matches
    // the *current* `/catalog/events/new` URL (`new` satisfies `[^/]+`
    // too), so `waitForURL` would resolve immediately without waiting for
    // the post-create redirect at all.
    await page.waitForURL(
      (url) =>
        /\/catalog\/events\/[^/]+$/.test(url.pathname) &&
        !url.pathname.endsWith("/new"),
    );
    const match = /\/catalog\/events\/([^/?]+)/.exec(page.url());
    eventId = match?.[1] ?? null;
    expect(eventId).not.toBeNull();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    // Edit.
    await page.goto(`/catalog/events/${String(eventId)}/edit`);
    await page.getByLabel("タイトル").fill(editedTitle);
    await page.getByRole("button", { name: "基本情報を保存" }).click();
    await expect(page.getByRole("status")).toHaveText("保存しました。");

    const catalogContext = "month=2026-09&date=2026-09-11";
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/catalog/events/${String(eventId)}?${catalogContext}`);
    await expect(
      page.getByRole("heading", { name: editedTitle }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "編集" })).toHaveAttribute(
      "href",
      `/catalog/events/${String(eventId)}/edit?${catalogContext}`,
    );

    const viewer = await provisionActor(admin, "e2e-event-viewer");
    viewerUserId = viewer.userId;
    viewerContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    const viewerPage = await viewerContext.newPage();
    await completeMagicLinkSignIn(viewerPage, viewer.email);
    await viewerPage.goto(
      `/catalog/events/${String(eventId)}?${catalogContext}`,
    );
    await expect(
      viewerPage.getByRole("heading", { name: editedTitle }),
    ).toBeVisible();
    await expect(viewerPage.getByRole("link", { name: "編集" })).toHaveCount(0);
  } finally {
    await viewerContext?.close();
    if (eventId !== null) {
      // No occurrence was ever created for this event, so a plain delete
      // (no participation/invitation rows to clear first) is enough -
      // unlike `participation.spec.ts`/`invitation.spec.ts`'s
      // `cleanupSeededEvent`.
      const { error } = await admin.from("events").delete().eq("id", eventId);
      if (error) {
        console.warn(
          `[e2e cleanup] failed to delete event ${eventId}: ${error.message}`,
        );
      }
    }
    if (viewerUserId !== null) {
      await deleteActor(admin, viewerUserId);
    }
    await deleteActor(admin, actor.userId);
  }
});
