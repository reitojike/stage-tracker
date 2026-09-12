import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import type { Database } from "../../src/lib/data/database.types";
import {
  PWA_ICON_ASSETS,
  PWA_MANIFEST_PATH,
} from "../../src/lib/pwa/app-identity";
import {
  createE2eAdminClient,
  deleteActor,
  provisionActor,
} from "../support/adminClient";
import { readLocalSupabaseStatus } from "../support/localSupabase";
import { completeMagicLinkSignIn } from "../support/signIn";

/**
 * Current Auth authority. These tests exercise the current Next.js app over
 * real HTTP and the real local Supabase Auth service. Browser-only WebAuthn
 * ceremonies remain manual-smoke coverage; route/session/credential API
 * boundaries are deterministic here.
 */

test("anonymous routes are default-deny and public paths are exact", async ({
  request,
}) => {
  const protectedPaths = [
    "/",
    "/catalog?probe=must-not-survive",
    "/events/some-future-page",
    "/events/some-future-page.png",
    "/sign-in/internal",
    "/auth/confirm/debug",
    "/pwa/secret.png",
    "/pwa/icon-192.png/sub",
  ];

  for (const path of protectedPaths) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), `${path} should be guarded`).toBe(307);
    const location = response.headers().location;
    expect(location, `${path} should redirect`).toBeDefined();
    expect(new URL(location!, "http://localhost:3100").pathname).toBe(
      "/sign-in",
    );
    expect(new URL(location!, "http://localhost:3100").search).toBe("");
  }

  const signIn = await request.get("/sign-in", { maxRedirects: 0 });
  expect(signIn.status()).toBe(200);
  expect(await signIn.text()).toContain('name="email"');

  const manifest = await request.get(PWA_MANIFEST_PATH, { maxRedirects: 0 });
  expect(manifest.status()).toBe(200);
  expect(manifest.headers()["content-type"]).toContain(
    "application/manifest+json",
  );

  for (const asset of PWA_ICON_ASSETS) {
    const response = await request.get(asset.path, { maxRedirects: 0 });
    expect(response.status(), asset.path).toBe(200);
    expect(response.headers()["content-type"], asset.path).toContain(
      "image/png",
    );
  }
});

interface SignInActionObservation {
  readonly status: number;
  readonly headers: readonly string[];
  readonly finalUrl: string;
  readonly renderedText: string;
}

async function submitSignIn(
  page: Page,
  email: string,
): Promise<SignInActionObservation> {
  await page.goto("/sign-in");
  await page.getByLabel("メールアドレス").fill(email);

  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/sign-in",
  );
  await page.getByRole("button", { name: "リンクをリクエスト" }).click();
  const response = await responsePromise;
  await page.waitForURL(/\/sign-in\?requested=1/);

  const ignoredHeaders = new Set([
    "content-length",
    "date",
    "etag",
    "x-nextjs-date",
    "x-vercel-id",
  ]);
  const headers = Object.entries(await response.allHeaders())
    .filter(([name]) => !ignoredHeaders.has(name.toLowerCase()))
    .map(([name, value]) => `${name.toLowerCase()}: ${value}`)
    .sort();

  return {
    status: response.status(),
    headers,
    finalUrl: new URL(page.url()).pathname + new URL(page.url()).search,
    // Next.js embeds request-random metadata ids in the RSC wire body. The
    // user-observable body is the rendered document text, which must not
    // vary with account existence.
    renderedText: await page.locator("body").innerText(),
  };
}

test("known and unknown email requests are observably identical", async ({
  page,
}) => {
  const admin = createE2eAdminClient();
  const actor = await provisionActor(admin, "e2e-enumeration-known");

  try {
    const known = await submitSignIn(page, actor.email);
    const unknownEmail = `e2e-enumeration-unknown-${String(Date.now())}@example.test`;
    const unknown = await submitSignIn(page, unknownEmail);

    expect(known).toEqual(unknown);
    expect(known.finalUrl).toBe("/sign-in?requested=1");
    expect(known.finalUrl).not.toContain("sent=1");

    const { data: users, error: listError } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    expect(listError).toBeNull();
    expect(users.users.some((user) => user.email === unknownEmail)).toBe(false);
  } finally {
    await deleteActor(admin, actor.userId);
  }
});

test("magic-link session reaches the app and sign-out invalidates it", async ({
  page,
}) => {
  const admin = createE2eAdminClient();
  const actor = await provisionActor(admin, "e2e-signin");

  try {
    await completeMagicLinkSignIn(page, actor.email);

    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('[data-slot="app-shell"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "ホーム" })).toBeVisible();

    await page.goto("/mypage");
    await page.getByRole("button", { name: "サインアウト" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);

    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in$/);
  } finally {
    await deleteActor(admin, actor.userId);
  }
});

test("local Supabase enforces the Passkey credential and session boundary", async () => {
  const status = readLocalSupabaseStatus();
  const createPasskeyClient = () =>
    createClient<Database>(status.apiUrl, status.anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        experimental: { passkey: true },
      },
    });

  const anonymous = createPasskeyClient();
  const anonymousList = await anonymous.auth.passkey.list();
  expect(anonymousList.data).toBeNull();
  expect(anonymousList.error).not.toBeNull();
  const anonymousDelete = await anonymous.auth.passkey.delete({
    passkeyId: "00000000-0000-0000-0000-000000000000",
  });
  expect(anonymousDelete.error).not.toBeNull();

  const admin = createE2eAdminClient();
  const actor = await provisionActor(admin, "e2e-passkey-list");

  try {
    const { data: linkData, error: linkError } =
      await admin.auth.admin.generateLink({
        type: "magiclink",
        email: actor.email,
      });
    expect(linkError).toBeNull();
    if (linkData.properties === null) {
      throw new Error("expected generateLink to return magic-link properties");
    }

    const authenticated = createPasskeyClient();
    const verification = await authenticated.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: "email",
    });
    expect(verification.error).toBeNull();

    const authenticatedList = await authenticated.auth.passkey.list();
    expect(authenticatedList.error).toBeNull();
    expect(authenticatedList.data).toEqual([]);

    const withoutOptIn = createClient<Database>(status.apiUrl, status.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await expect(withoutOptIn.auth.passkey.list()).rejects.toThrow();
  } finally {
    await deleteActor(admin, actor.userId);
  }
});
