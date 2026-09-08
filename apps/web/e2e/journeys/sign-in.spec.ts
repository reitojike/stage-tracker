import { expect, test } from "@playwright/test";
import {
  createE2eAdminClient,
  deleteActor,
  provisionActor,
} from "../support/adminClient";
import { completeMagicLinkSignIn } from "../support/signIn";

/**
 * Sign-in journey (Issue #380 primary journey 1): magic-link request ->
 * Mailpit -> the app's real `/auth/confirm` -> lands on `/` with the
 * authenticated AppShell. This is the one journey every other spec in this
 * suite also depends on for its own sign-in step; it is verified on its
 * own here so a regression in the auth path itself is reported at its
 * actual source instead of surfacing as an unrelated failure in every
 * other journey.
 *
 * What this does *not* re-verify: the enumeration-safety behavior (same
 * response for known/unknown email), passkeys, and route-protection
 * redirects - those are already covered by
 * `apps/legacy-web/test/auth/*.test.ts` against the same oracle behavior,
 * and this suite's job (Issue #380) is E2E journey coverage, not
 * duplicating that suite.
 */
test("magic-link sign-in reaches the authenticated home screen", async ({
  page,
}) => {
  const admin = createE2eAdminClient();
  const actor = await provisionActor(admin, "e2e-signin");

  try {
    await completeMagicLinkSignIn(page, actor.email);

    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('[data-slot="app-shell"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "ホーム" })).toBeVisible();
  } finally {
    await deleteActor(admin, actor.userId);
  }
});
