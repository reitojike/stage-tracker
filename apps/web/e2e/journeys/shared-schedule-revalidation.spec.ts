import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import {
  createE2eAdminClient,
  provisionActor,
  seedLegacyScheduleShare,
} from "../support/adminClient";
import { completeMagicLinkSignIn } from "../support/signIn";
import { tokyoTodayDateString } from "../support/seedCatalog";
import { readScheduleContactCapability } from "../support/scheduleContactCapability";

const test = base.extend<{
  resources: {
    admin: ReturnType<typeof createE2eAdminClient>;
    actor: (prefix: string) => ReturnType<typeof provisionActor>;
    context: () => Promise<BrowserContext>;
  };
}>({
  resources: async ({ browser }, use, testInfo) => {
    const admin = createE2eAdminClient();
    const actors: string[] = [];
    const contexts: BrowserContext[] = [];
    try {
      await use({
        admin,
        actor: async (prefix) => {
          const actor = await provisionActor(admin, prefix);
          actors.push(actor.userId);
          return actor;
        },
        context: async () => {
          const context = await browser.newContext();
          contexts.push(context);
          return context;
        },
      });
    } finally {
      const errors: string[] = [];
      for (const context of contexts) {
        try {
          await context.close();
        } catch (error) {
          errors.push(`context close: ${String(error)}`);
        }
      }
      for (const userId of actors) {
        try {
          const deletion = await admin.auth.admin.deleteUser(userId);
          const lookup = await admin.auth.admin.getUserById(userId);
          if (
            deletion.error ||
            lookup.data.user ||
            lookup.error?.status !== 404
          )
            throw new Error("actor deletion could not be confirmed");
        } catch (error) {
          errors.push(`actor cleanup: ${String(error)}`);
        }
      }
      if (errors.length) {
        await testInfo.attach("cleanup-errors", {
          body: JSON.stringify(errors),
          contentType: "application/json",
        });
        // Preserve an existing journey failure; a passing journey must still
        // fail if teardown or verified actor deletion did not complete.
        if (testInfo.status === testInfo.expectedStatus)
          throw new Error(errors.join("\n"));
      }
    }
  },
});

// Shares are synthetic fixtures: no registration-gate override or DB
// permission change. The application reads them through ordinary auth and RLS.
test("shared schedule revalidation: history, tab resume, slow/offline read and own input", async ({
  resources,
}) => {
  // Keep the existing journey budget; readiness uses normal UI assertions.
  test.setTimeout(60_000);
  const { admin } = resources;
  const owner = await resources.actor("e2e-cache-owner");
  const recipient = await resources.actor("e2e-cache-recipient");
  const ownerContext = await resources.context();
  const recipientContext = await resources.context();
  const title = `E2E-private-cache-${Date.now()}`;
  const ownTitle = `E2E-own-cache-${Date.now()}`;
  async function create(page: Page, name: string) {
    await page.goto("/schedule/new");
    await page.getByLabel("件名").fill(name);
    await page.getByLabel("開始日").fill(tokyoTodayDateString());
    await page.getByRole("button", { name: "作成する" }).click();
    await page.waitForURL(/\/calendar/);
    await page.getByRole("link", { name }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    return new URL(page.url()).pathname;
  }
  const ownerPage = await ownerContext.newPage(),
    page = await recipientContext.newPage();
  await completeMagicLinkSignIn(ownerPage, owner.email);
  const detail = await create(ownerPage, title),
    entryId = detail.split("/").at(-1);
  if (!entryId) throw new Error("missing fixture entry ID");
  await completeMagicLinkSignIn(page, recipient.email);
  const ownDetail = await create(page, ownTitle);
  const registrationEnabled = await readScheduleContactCapability(
    page,
    recipient.userId,
  );

  let acceptedContactId: string | undefined;
  if (registrationEnabled) {
    // This trusted setup represents an already-accepted generation only for
    // the cache-read fixture. Contact consent/acceptance is covered by the
    // separate personal-schedule journey's real UI flow.
    const [userLowId, userHighId] = [owner.userId, recipient.userId].sort();
    if (!userLowId || !userHighId)
      throw new Error("missing contact participants");
    const { data: contact, error } = await admin
      .from("schedule_contacts")
      .insert({ user_low_id: userLowId, user_high_id: userHighId })
      .select("id")
      .single();
    if (error || !contact)
      throw new Error(
        `could not seed accepted contact generation: ${error?.message ?? "missing contact"}`,
      );
    acceptedContactId = contact.id;
  }

  const seed = async () => {
    if (!acceptedContactId)
      return seedLegacyScheduleShare(entryId, recipient.userId);
    const { error } = await admin.from("personal_schedule_shares").insert({
      schedule_entry_id: entryId,
      shared_with_user_id: recipient.userId,
      contact_id: acceptedContactId,
    });
    if (error) throw error;
  };
  const revoke = async () => {
    const { error } = await admin
      .from("personal_schedule_shares")
      .delete()
      .eq("schedule_entry_id", entryId);
    if (error) throw error;
  };
  await seed();
  let mode: "pass" | "hold" | "fail" = "pass";
  const held: Route[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"])
      return route.continue();
    if (mode === "fail") return route.abort("internetdisconnected");
    if (mode === "hold") {
      held.push(route);
      return;
    }
    return route.continue();
  });
  async function resume() {
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  }
  async function hidden() {
    // Includes titles, aria labels, month bands and overflow labels, not only rows.
    const projection = page.locator("body");
    await expect(projection).not.toContainText(title);
    expect(
      await page
        .locator(`[aria-label*="${title}"], [title*="${title}"]`)
        .count(),
    ).toBe(0);
  }
  async function release() {
    mode = "pass";
    for (const route of held.splice(0)) await route.continue();
  }
  await page.goto("/calendar");
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  await page.getByRole("link", { name: title }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.getByRole("link", { name: "カレンダーへ戻る" }).click();
  await expect(page).toHaveURL(/\/calendar/);
  await revoke();
  mode = "hold";
  await page.evaluate((secret) => {
    const samples: string[] = [];
    let stopped = false;
    window.addEventListener(
      "popstate",
      () => {
        const scan = () => {
          if (stopped) return;
          if (document.body.innerText.includes(secret)) samples.push("visible");
          requestAnimationFrame(scan);
        };
        requestAnimationFrame(scan);
      },
      { once: true },
    );
    document.addEventListener(
      "stop-shared-probe",
      () => {
        stopped = true;
        document.documentElement.dataset.sharedProbe = JSON.stringify(samples);
      },
      { once: true },
    );
  }, title);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(detail + "(?:\\?.*)?$"));
  await expect(page.getByText("共有予定を確認中です")).toBeVisible();
  await hidden();
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await hidden();
  await release();
  await expect(page.getByText("この予定は見つかりませんでした")).toBeVisible();
  expect(
    await page.evaluate(() => {
      document.dispatchEvent(new Event("stop-shared-probe"));
      return document.documentElement.dataset.sharedProbe;
    }),
  ).toBe("[]");

  // Forward restore also starts from the calendar snapshot that previously
  // contained the grant. Watch the restore itself for a stale-title flash.
  await page.evaluate((secret) => {
    const samples: string[] = [];
    let stopped = false;
    window.addEventListener(
      "popstate",
      () => {
        const scan = () => {
          if (stopped) return;
          if (document.body.innerText.includes(secret)) samples.push("visible");
          requestAnimationFrame(scan);
        };
        requestAnimationFrame(scan);
      },
      { once: true },
    );
    document.addEventListener(
      "stop-shared-forward-probe",
      () => {
        stopped = true;
        document.documentElement.dataset.sharedForwardProbe =
          JSON.stringify(samples);
      },
      { once: true },
    );
  }, title);
  mode = "hold";
  await page.goForward();
  await expect(page).toHaveURL(/\/calendar/);
  const calendar = page
    .getByRole("main")
    .filter({ visible: true })
    .filter({
      has: page.getByRole("heading", { name: "カレンダー", exact: true }),
    });
  await expect(calendar).toBeVisible();
  await expect(
    calendar.getByText("共有予定を確認中です", { exact: true }),
  ).toBeVisible();
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await hidden();
  await release();
  await expect(calendar.getByRole("link", { name: ownTitle })).toBeVisible();
  for (const notice of [
    "共有予定を確認中です",
    "共有予定を確認できません",
    "サインイン状態が変わりました。画面を開き直してください",
  ]) {
    await expect(calendar.getByText(notice, { exact: true })).toHaveCount(0);
  }
  await hidden();
  expect(
    await page.evaluate(() => {
      document.dispatchEvent(new Event("stop-shared-forward-probe"));
      return document.documentElement.dataset.sharedForwardProbe;
    }),
  ).toBe("[]");

  // Both combined projections retain the owner's entries while shared data is
  // unknown. An offline response must not revive a previously authorized title.
  for (const url of ["/calendar", "/"]) {
    await seed();
    await page.goto(url);
    await expect(page.getByRole("link", { name: title })).toBeVisible();
    await expect(page.getByRole("link", { name: ownTitle })).toBeVisible();
    await revoke();
    mode = "hold";
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await hidden();
    await resume();
    await expect.poll(() => held.length).toBeGreaterThan(0);
    await hidden();
    await expect(page.getByRole("link", { name: ownTitle })).toBeVisible();
    mode = "fail";
    for (const route of held.splice(0))
      await route.abort("internetdisconnected");
    await expect(
      page.getByText("共有予定を確認できません", { exact: true }),
    ).toBeVisible();
    await hidden();
    await expect(page.getByRole("link", { name: ownTitle })).toBeVisible();
    mode = "pass";
    await page.getByRole("button", { name: "共有予定を再確認" }).click();
    await expect(page.getByText("共有予定を確認中です")).toHaveCount(0);
    await hidden();
  }
  // The owner's form is outside the shared-read boundary and keeps unsaved input.
  await page.goto(ownDetail + "/edit");
  await page.getByLabel("件名").fill("unsaved owner input");
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.getByLabel("件名")).toHaveValue("unsaved owner input");
  await page.screenshot({
    path: test.info().outputPath("shared-hidden-own-input.png"),
    fullPage: true,
  });
});
