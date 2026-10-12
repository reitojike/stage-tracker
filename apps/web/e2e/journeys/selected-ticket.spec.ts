import { expect, test, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
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

function dateAfter(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function unobscured(link: Locator) {
  return link.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const bottom = Math.min(
      window.innerHeight,
      ...Array.from(document.querySelectorAll("nav"))
        .filter((nav) =>
          ["fixed", "sticky"].includes(getComputedStyle(nav).position),
        )
        .map((nav) => nav.getBoundingClientRect())
        .filter((r) => r.height > 0 && r.top > window.innerHeight / 2)
        .map((r) => r.top),
    );
    return {
      visible: rect.height > 0 && rect.top >= 0 && rect.bottom <= bottom,
      top: rect.top,
      bottom: rect.bottom,
      viewportBottom: bottom,
      scrollY: window.scrollY,
    };
  });
}

test("Home selected receipt, official source, history and owner state isolation", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  test.setTimeout(150_000);
  expect(page.url()).toBe("about:blank");
  if (testInfo.project.name === "mobile-chromium")
    await page.setViewportSize({ width: 393, height: 757 });
  const admin = createE2eAdminClient();
  const actor = await provisionActor(admin, "e2e-selected-ticket");
  const recipient = await provisionActor(admin, "e2e-selected-recipient");
  let eventId: string | undefined;
  const a = randomUUID(),
    b = randomUUID(),
    old = randomUUID(),
    zero = randomUUID();
  const source = `https://tickets.example.test/receipt/${a}`;
  const observations: Record<string, unknown> = {};
  try {
    const today = tokyoTodayDateString(),
      eventDate = dateAfter(today, 30);
    const fixture = await seedEventWithOccurrence(admin, {
      ownerId: actor.userId,
      title: `E2E selected receipt ${a}`,
      tokyoDate: eventDate,
      occurrenceStartsAt: `${eventDate}T19:00:00+09:00`,
    });
    eventId = fixture.eventId;
    const { error: opportunityError } = await admin
      .from("ticket_opportunities")
      .insert(
        [a, b, old, zero].map((id) => ({
          id,
          event_id: fixture.eventId,
          display_name:
            id === a || id === b
              ? "E2E 同名・同日でも別の受付 長い名前を省略せず表示"
              : `E2E ${id === old ? "過去" : "日程未登録"}の受付`,
          target_scope: "event_wide",
          source_key: `e2e-selected-${id}`,
          source_url: id === a ? source : null,
        })),
      );
    expect(opportunityError).toBeNull();
    const { error: milestoneError } = await admin
      .from("ticket_opportunity_milestones")
      .insert([
        {
          opportunity_id: a,
          milestone_type: "application_close",
          temporal_precision: "date",
          date_value: dateAfter(today, 10),
        },
        {
          opportunity_id: a,
          milestone_type: "result_announcement",
          temporal_precision: "date",
          date_value: dateAfter(today, 11),
        },
        {
          opportunity_id: b,
          milestone_type: "application_close",
          temporal_precision: "date",
          date_value: dateAfter(today, 10),
        },
        {
          opportunity_id: old,
          milestone_type: "application_close",
          temporal_precision: "date",
          date_value: dateAfter(today, -30),
        },
      ]);
    expect(milestoneError).toBeNull();
    const { error: ownError } = await admin
      .from("user_ticket_opportunity_states")
      .insert([
        { user_id: actor.userId, opportunity_id: a, status: "planned" },
        { user_id: actor.userId, opportunity_id: b, status: "applied" },
        { user_id: actor.userId, opportunity_id: old, status: "planned" },
        { user_id: recipient.userId, opportunity_id: a, status: "applied" },
      ]);
    expect(ownError).toBeNull();
    const snapshotStates = async () => {
      const result = await admin
        .from("user_ticket_opportunity_states")
        .select("user_id,opportunity_id,status,updated_at")
        .in("user_id", [actor.userId, recipient.userId])
        .order("user_id")
        .order("opportunity_id");
      expect(result.error).toBeNull();
      return result.data;
    };
    const before = await snapshotStates();
    await context.route(source, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Safe official landing fixture</title><h1>Official information fixture</h1>",
      }),
    );
    await completeMagicLinkSignIn(page, actor.email);
    const href = `/tickets?opportunity=${a}`;
    const home = page.locator(`a[href="${href}"]`);
    await expect(home).toHaveCount(1);
    await home.click();
    await page.waitForURL(
      (url) =>
        url.pathname === "/tickets" &&
        url.searchParams.get("opportunity") === a,
    );
    const receipt = page.getByRole("region", { name: "選択した受付" });
    await expect(receipt).toBeVisible();
    await expect(
      receipt.getByText("自分：申込予定", { exact: true }),
    ).toBeVisible();
    await expect(receipt.getByText("受付締切", { exact: true })).toBeVisible();
    await expect(receipt.getByText("当落発表", { exact: true })).toBeVisible();
    const official = page.getByRole("link", { name: "公式情報を開く" });
    expect(await official.getAttribute("href")).toBe(source);
    await expect
      .poll(async () => (await unobscured(official)).visible)
      .toBe(true);
    observations.arrival = await unobscured(official);
    expect(new URL(page.url()).hash).toBe("");
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("selected-receipt.png"),
      fullPage: true,
    });
    const popupPromise = context.waitForEvent("page");
    await official.click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(source);
    await expect(popup).toHaveTitle("Safe official landing fixture");
    observations.externalTarget = popup.url();
    await popup.close();

    await page.getByRole("link", { name: "公演情報", exact: true }).click();
    await page.waitForURL(
      (url) => url.pathname === `/catalog/events/${fixture.eventId}`,
    );
    await page.goBack();
    await expect(receipt).toBeVisible();
    await expect
      .poll(async () => (await unobscured(official)).visible)
      .toBe(true);
    observations.eventBack = await unobscured(official);
    // Natural keyboard navigation must reach a visible control, not an offscreen row.
    await page.keyboard.press("Tab");
    observations.tabAfterBack = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      href: document.activeElement?.getAttribute("href"),
      top: document.activeElement?.getBoundingClientRect().top,
    }));
    const activeRect = await page.evaluate(() => {
      const element = document.activeElement;
      const rect = element?.getBoundingClientRect();
      return { tag: element?.tagName, top: rect?.top, bottom: rect?.bottom };
    });
    expect(["A", "BUTTON"]).toContain(activeRect.tag);
    expect(activeRect?.top).toBeGreaterThanOrEqual(0);
    expect(activeRect?.bottom).toBeLessThanOrEqual(
      page.viewportSize()?.height ?? 0,
    );
    await page.goForward();
    await page.waitForURL(
      (url) => url.pathname === `/catalog/events/${fixture.eventId}`,
    );
    await page.goBack();
    await expect(receipt).toBeVisible();
    await page.reload();
    await expect(
      receipt.getByText("自分：申込予定", { exact: true }),
    ).toBeVisible();
    await page.goBack();
    await expect(home).toBeVisible();
    await page.goForward();
    await expect(receipt).toBeVisible();
    await page.getByRole("link", { name: "受付一覧", exact: true }).click();
    await page.waitForURL(
      (url) =>
        url.pathname === "/tickets" && !url.searchParams.has("opportunity"),
    );
    await expect(
      page.getByRole("heading", { name: "チケット", exact: true }),
    ).toBeVisible();
    await page.goBack();
    await expect(receipt).toBeVisible();

    // Address navigation A→B→A exercises distinct public identity and saved owner state.
    await page.goto(`/tickets?opportunity=${b}&view=past`);
    await expect(
      receipt.getByText("自分：申込済み", { exact: true }),
    ).toBeVisible();
    await expect(
      receipt.getByRole("button", { name: "申し込む予定に戻す" }),
    ).toBeVisible();
    await expect(
      receipt.getByRole("button", { name: "申し込み済みにする" }),
    ).toHaveCount(0);
    await page.goBack();
    await expect(
      receipt.getByText("自分：申込予定", { exact: true }),
    ).toBeVisible();
    await page.goto(`/tickets?opportunity=${old}`);
    await expect(receipt.getByText("受付終了", { exact: true })).toBeVisible();
    await expect(receipt.getByRole("button")).toHaveCount(0);
    await page.goto(`/tickets?opportunity=${zero}`);
    await expect(receipt.getByText("受付の日程情報はありません")).toBeVisible();
    await expect(receipt.getByRole("button")).toHaveCount(0);
    await page.goto(`/tickets?opportunity=${randomUUID()}`);
    await expect(page.getByText("受付が見つかりません")).toBeVisible();
    await page.goto(`/tickets?opportunity=${a}&opportunity=${b}`);
    await expect(page.getByText("受付の指定が正しくありません")).toBeVisible();

    const browser = context.browser();
    if (browser === null) throw new Error("browser fixture unavailable");
    if (baseURL === undefined) throw new Error("baseURL fixture unavailable");
    const viewport = page.viewportSize();
    const sharedContext = await browser.newContext({
      baseURL,
      ...(viewport === null ? {} : { viewport }),
    });
    try {
      const shared = await sharedContext.newPage();
      await shared.goto(href);
      await expect(
        shared.getByRole("heading", { name: "サインイン" }),
      ).toBeVisible();
      await completeMagicLinkSignIn(shared, recipient.email);
      await shared.goto(href);
      await expect(
        shared.getByText("自分：申込済み", { exact: true }),
      ).toBeVisible();
      await shared.goto(`/tickets?opportunity=${b}`);
      await expect(
        shared.getByText("自分：未登録", { exact: true }),
      ).toBeVisible();
    } finally {
      await sharedContext.close();
    }
    expect(await snapshotStates()).toEqual(before);
    observations.stateUnchanged = true;
  } finally {
    await writeFile(
      testInfo.outputPath("observations.json"),
      JSON.stringify(observations, null, 2),
    );
    await testInfo.attach("selected-ticket-observations", {
      body: JSON.stringify(observations, null, 2),
      contentType: "application/json",
    });
    if (eventId !== undefined) {
      const { error } = await admin
        .from("ticket_opportunities")
        .delete()
        .eq("event_id", eventId);
      expect(error).toBeNull();
      await cleanupSeededEvent(admin, eventId);
    }
    await deleteActor(admin, actor.userId);
    await deleteActor(admin, recipient.userId);
  }
});
