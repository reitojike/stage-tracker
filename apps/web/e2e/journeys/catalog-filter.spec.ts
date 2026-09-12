import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/data/database.types";
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

const FILTER_STORAGE_KEY = "stage-tracker:catalog-filter:v1";

interface SeededCatalogFilterFixture {
  readonly classifiedEventId: string;
  readonly unclassifiedEventId: string;
  readonly classifiedTitle: string;
  readonly unclassifiedTitle: string;
}

async function seedCatalogFilterFixture(
  admin: SupabaseClient<Database>,
  ownerId: string,
  tokyoDate: string,
): Promise<SeededCatalogFilterFixture> {
  const { data: genre, error: genreError } = await admin
    .from("genres")
    .select("id")
    .eq("key", "takarazuka")
    .single();
  if (genreError || genre === null) {
    throw new Error(
      `failed to find takarazuka genre for e2e fixture: ${genreError?.message ?? "unknown error"}`,
    );
  }

  const classifiedTitle = `E2E絞り込み対象-${Date.now()}`;
  const unclassifiedTitle = `E2E絞り込み対象外-${Date.now()}`;
  const { data: classifiedEvent, error: classifiedEventError } = await admin
    .from("events")
    .insert({
      owner_id: ownerId,
      title: classifiedTitle,
      starts_on: tokyoDate,
      ends_on: tokyoDate,
      genre_id: genre.id,
    })
    .select("id")
    .single();
  if (classifiedEventError || classifiedEvent === null) {
    throw new Error(
      `failed to seed classified e2e event: ${classifiedEventError?.message ?? "unknown error"}`,
    );
  }

  const { error: occurrenceError } = await admin
    .from("event_occurrences")
    .insert({
      event_id: classifiedEvent.id,
      starts_at: `${tokyoDate}T19:00:00+09:00`,
    });
  if (occurrenceError) {
    throw new Error(
      `failed to seed classified e2e occurrence: ${occurrenceError.message}`,
    );
  }

  const unclassified = await seedEventWithOccurrence(admin, {
    ownerId,
    title: unclassifiedTitle,
    tokyoDate,
    occurrenceStartsAt: `${tokyoDate}T20:00:00+09:00`,
  });

  return {
    classifiedEventId: classifiedEvent.id,
    unclassifiedEventId: unclassified.eventId,
    classifiedTitle,
    unclassifiedTitle,
  };
}

/**
 * Catalog filter Sheet lifecycle (Issue #421): draft changes stay local to
 * the open Sheet until confirmation, dismiss starts the next session from
 * applied state, and the existing external reset remains immediate.
 */
test("catalog filter Sheet: dismiss draft, confirm, reload, and reset", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });

  const admin = createE2eAdminClient();
  const actor = await provisionActor(admin, "e2e-catalog-filter");
  const tokyoDate = tokyoTodayDateString();
  const fixture = await seedCatalogFilterFixture(
    admin,
    actor.userId,
    tokyoDate,
  );

  try {
    await completeMagicLinkSignIn(page, actor.email);
    await page.evaluate(
      (key) => localStorage.removeItem(key),
      FILTER_STORAGE_KEY,
    );
    await page.goto(`/catalog?date=${tokyoDate}`);

    const trigger = page.getByRole("button", { name: "絞り込み" });
    await expect(trigger).toBeVisible();
    await trigger.click();
    const sheet = page.getByRole("dialog", { name: "絞り込み" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("radio", { name: "すべて" })).toBeChecked();

    await sheet.getByRole("radio", { name: "宝塚" }).click();
    // The open Sheet marks the underlying page inert/aria-hidden. Count the
    // underlying links instead of asserting visibility while the modal is up:
    // draft changes must not change the applied list.
    await expect(
      page.locator("a").filter({ hasText: fixture.classifiedTitle }),
    ).toHaveCount(1);
    await expect(
      page.locator("a").filter({ hasText: fixture.unclassifiedTitle }),
    ).toHaveCount(1);
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        FILTER_STORAGE_KEY,
      ),
    ).toBeNull();

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();

    // Escape discarded the draft: this fresh open starts from applied=all.
    await trigger.click();
    await expect(sheet.getByRole("radio", { name: "すべて" })).toBeChecked();

    await sheet.getByRole("radio", { name: "宝塚" }).click();
    await page.getByTestId("sheet-backdrop").click();
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();

    // Backdrop dismissal also leaves applied=all and starts a fresh draft.
    await trigger.click();
    await expect(sheet.getByRole("radio", { name: "すべて" })).toBeChecked();

    await sheet.getByRole("radio", { name: "宝塚" }).click();
    await sheet.getByRole("button", { name: "この条件で絞り込む" }).click();
    await expect(sheet).toBeHidden();
    await expect(
      page.getByRole("link", { name: fixture.classifiedTitle }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: fixture.unclassifiedTitle }),
    ).not.toBeVisible();
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        FILTER_STORAGE_KEY,
      ),
    ).toEqual(
      JSON.stringify({ genreKey: "takarazuka", groupIds: [], venues: [] }),
    );

    await page.reload();
    await expect(
      page.getByRole("link", { name: fixture.classifiedTitle }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: fixture.unclassifiedTitle }),
    ).not.toBeVisible();

    await page.getByRole("button", { name: "絞り込み（適用中）" }).click();
    await expect(sheet.getByRole("radio", { name: "宝塚" })).toBeChecked();
    await sheet.getByRole("radio", { name: "すべて" }).click();
    await sheet.getByRole("button", { name: "条件をクリア" }).click();
    await expect(sheet.getByRole("radio", { name: "すべて" })).toBeChecked();
    await expect(
      page.locator("a").filter({ hasText: fixture.unclassifiedTitle }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        FILTER_STORAGE_KEY,
      ),
    ).toEqual(
      JSON.stringify({ genreKey: "takarazuka", groupIds: [], venues: [] }),
    );

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "絞り込みを解除" }).click();
    await expect(
      page.getByRole("link", { name: fixture.unclassifiedTitle }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        FILTER_STORAGE_KEY,
      ),
    ).toEqual(JSON.stringify({ genreKey: null, groupIds: [], venues: [] }));
  } finally {
    await cleanupSeededEvent(admin, fixture.classifiedEventId);
    await cleanupSeededEvent(admin, fixture.unclassifiedEventId);
    await deleteActor(admin, actor.userId);
  }
});
