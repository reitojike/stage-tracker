import type { Page } from "@playwright/test";
import { waitForMagicLinkToken } from "./mailpit";

/**
 * Completes a real magic-link sign-in through the app's own UI and its own
 * `/auth/confirm` Route Handler - never a Supabase SDK session shortcut.
 * This matters because `/auth/confirm` is itself the cookie-issuing route
 * (`src/app/auth/confirm/route.ts`); creating a session any other way
 * would leave that route entirely unexercised by this suite.
 *
 * Steps (mirrors the real user journey `docs/v2/oracle-routes-ui.md` §1
 * `/sign-in` describes):
 * 1. Submit the `/sign-in` form for `email` (exercises
 *    `requestSignInLink` / `requestMagicLink`, which sends the email via
 *    the local Supabase stack's real `signInWithOtp`).
 * 2. Poll Mailpit (the local stack's SMTP capture service) for that email
 *    and read the `token_hash`/`type` pair out of its `/auth/confirm` link.
 * 3. Navigate the browser to that `/auth/confirm` URL. The browser handles
 *    the resulting `Set-Cookie` exactly as it would for a real clicked
 *    link, landing on `/` (AppShell) once the session cookie is set.
 */
export async function completeMagicLinkSignIn(
  page: Page,
  email: string,
): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByRole("button", { name: "リンクをリクエスト" }).click();
  await page.waitForURL(/\/sign-in\?requested=1/);

  const { tokenHash, type } = await waitForMagicLinkToken(email);
  await page.goto(
    `/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(type)}`,
  );
}
