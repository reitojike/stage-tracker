import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
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

function dateAfter(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function seedOpportunities(
  admin: SupabaseClient<Database>,
  eventId: string,
  userId: string,
  today: string,
): Promise<string> {
  const inputs = Array.from({ length: 19 }, (_, index) => ({
    event_id: eventId,
    display_name:
      index === 18 ? "E2E selected application" : `E2E earlier sale ${index}`,
    target_scope: "event_wide",
    source_key: `e2e-ticket-anchor-${eventId}-${index}`,
    source_url: `https://tickets.example.test/${index}`,
  }));
  const { data, error } = await admin
    .from("ticket_opportunities")
    .insert(inputs)
    .select("id, display_name");
  if (error || data === null)
    throw new Error(`seed opportunities: ${error?.message}`);
  const target = data.find(
    (row) => row.display_name === "E2E selected application",
  );
  if (target === undefined) throw new Error("missing target opportunity");
  const milestones = data.map((row) => ({
    opportunity_id: row.id,
    milestone_type: "application_close",
    temporal_precision: "date",
    date_value: dateAfter(today, row.id === target.id ? 10 : 1),
  }));
  milestones.push({
    opportunity_id: target.id,
    milestone_type: "result_announcement",
    temporal_precision: "date",
    date_value: dateAfter(today, 11),
  });
  const { error: milestoneError } = await admin
    .from("ticket_opportunity_milestones")
    .insert(milestones);
  if (milestoneError)
    throw new Error(`seed milestones: ${milestoneError.message}`);
  const { error: stateError } = await admin
    .from("user_ticket_opportunity_states")
    .insert({ user_id: userId, opportunity_id: target.id, status: "planned" });
  if (stateError) throw new Error(`seed personal state: ${stateError.message}`);
  return target.id;
}

async function targetMetrics(page: Page, id: string) {
  return page.evaluate((targetId) => {
    const target = document.getElementById(targetId);
    if (target === null) return null;
    const rect = target.getBoundingClientRect();
    const fixedBottoms = Array.from(document.querySelectorAll("nav"))
      .filter((nav) =>
        ["fixed", "sticky"].includes(getComputedStyle(nav).position),
      )
      .map((nav) => nav.getBoundingClientRect())
      .filter((nav) => nav.height > 0 && nav.top >= window.innerHeight / 2);
    const bottom = Math.min(
      window.innerHeight,
      ...fixedBottoms.map((nav) => nav.top),
    );
    const fixedTops = Array.from(document.querySelectorAll("header"))
      .filter((header) =>
        ["fixed", "sticky"].includes(getComputedStyle(header).position),
      )
      .map((header) => header.getBoundingClientRect())
      .filter(
        (header) => header.height > 0 && header.bottom < window.innerHeight / 2,
      );
    const top = Math.max(0, ...fixedTops.map((header) => header.bottom));
    return {
      scrollY: window.scrollY,
      targetTop: rect.top,
      targetBottom: rect.bottom,
      visibleTop: top,
      visibleBottom: bottom,
      viewportHeight: window.innerHeight,
      idCount: document.querySelectorAll(`[id="${targetId}"]`).length,
      focused: document.activeElement === target,
      outlineWidth: getComputedStyle(target).outlineWidth,
      outlineStyle: getComputedStyle(target).outlineStyle,
      visible: rect.top >= top && rect.bottom <= bottom,
    };
  }, id);
}

test("Home deadline reveals the exact opportunity after load and history navigation", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  if (testInfo.project.name === "mobile-chromium") {
    await page.setViewportSize({ width: 393, height: 757 });
  }
  const admin = createE2eAdminClient();
  const actor = await provisionActor(admin, "e2e-ticket-anchor");
  let eventId: string | undefined;
  try {
    const today = tokyoTodayDateString();
    const eventDate = dateAfter(today, 30);
    const fixture = await seedEventWithOccurrence(admin, {
      ownerId: actor.userId,
      title: `E2E ticket anchor ${actor.userId}`,
      tokyoDate: eventDate,
      occurrenceStartsAt: `${eventDate}T19:00:00+09:00`,
    });
    eventId = fixture.eventId;
    const opportunityId = await seedOpportunities(
      admin,
      eventId,
      actor.userId,
      today,
    );
    const targetId = `ticket-opportunity-${opportunityId}`;
    const href = `/tickets?view=upcoming#${targetId}`;
    const before = await admin
      .from("user_ticket_opportunity_states")
      .select("opportunity_id,status,updated_at")
      .eq("user_id", actor.userId);
    expect(before.error).toBeNull();

    const results: Record<
      string,
      Awaited<ReturnType<typeof targetMetrics>>
    > = {};
    const softExpect = expect.configure({ soft: true });
    async function checkTarget(name: string) {
      await expect(page.locator(`[id="${targetId}"]`).first()).toBeVisible();
      await softExpect
        .poll(async () => (await targetMetrics(page, targetId))?.visible, {
          message: `${name}: target is inside the unobscured viewport`,
          timeout: 5_000,
        })
        .toBe(true);
      await expect(page.locator(`[id="${targetId}"]`).first()).toBeFocused();
      results[name] = await targetMetrics(page, targetId);
      expect(results[name]?.outlineStyle).toBe("solid");
      expect(results[name]?.outlineWidth).toBe("2px");
      expect
        .soft(results[name]?.idCount, `${name}: one Opportunity anchor`)
        .toBe(1);
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
      console.log(
        "ticket-anchor-metrics:" + JSON.stringify({ name, ...results[name] }),
      );
    }

    await completeMagicLinkSignIn(page, actor.email);
    await expect(page.locator(`a[href="${href}"]`)).toBeVisible();
    await page.locator(`a[href="${href}"]`).click();
    await page.waitForURL(
      (url) => url.hash === `#${targetId}` && url.pathname === "/tickets",
    );
    await checkTarget("home-click");
    await page.goBack();
    await expect(page.locator(`a[href="${href}"]`)).toBeVisible();
    await page.goForward();
    await page.waitForURL(
      (url) => url.hash === `#${targetId}` && url.pathname === "/tickets",
    );
    await checkTarget("forward");
    await page.reload();
    await checkTarget("reload");
    await test.step("return via Home navigation and reopen the opportunity", async () => {
      await page
        .getByRole("navigation", { name: "主要ナビゲーション" })
        .getByRole("link", { name: "ホーム", exact: true })
        .click({ timeout: 10_000 });
      await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
      await expect(page.locator(`a[href="${href}"]`)).toBeVisible();
      await page.locator(`a[href="${href}"]`).click();
      await page.waitForURL(
        (url) => url.hash === `#${targetId}` && url.pathname === "/tickets",
      );
      await checkTarget("home-reentry");
    });

    await page.goto("/tickets?view=upcoming");
    await expect(page.locator(`[id="${targetId}"]`)).toBeVisible();
    expect((await targetMetrics(page, targetId))?.scrollY).toBe(0);
    await expect(page.locator(`[id="${targetId}"]`)).not.toBeFocused();
    await page.goto(
      "/tickets?view=upcoming#ticket-opportunity-00000000-0000-4000-8000-000000000000",
    );
    await expect(page.locator(`[id="${targetId}"]`)).toBeVisible();
    expect((await targetMetrics(page, targetId))?.scrollY).toBe(0);
    await expect(page.locator(`[id="${targetId}"]`)).not.toBeFocused();
    await page.goto(`/tickets?view=applied#${targetId}`);
    await expect(
      page.getByText("自分の申込済みの受付はありません", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(`[id="${targetId}"]`)).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "自分の申込済み", exact: true }),
    ).toHaveAttribute("aria-current", "page");

    const after = await admin
      .from("user_ticket_opportunity_states")
      .select("opportunity_id,status,updated_at")
      .eq("user_id", actor.userId);
    expect(after.error).toBeNull();
    expect(after.data).toEqual(before.data);
    const observationsPath = testInfo.outputPath("anchor-observations.json");
    await writeFile(observationsPath, JSON.stringify({ results }, null, 2));
    await testInfo.attach("anchor-observations", {
      path: observationsPath,
      contentType: "application/json",
    });
  } finally {
    if (eventId !== undefined) await cleanupSeededEvent(admin, eventId);
    await deleteActor(admin, actor.userId);
  }
});
