import { expect, test, type BrowserContext } from "@playwright/test";
import {
  createE2eAdminClient,
  deleteActor,
  grantCatalogCreator,
  provisionActor,
} from "../support/adminClient";
import { completeMagicLinkSignIn } from "../support/signIn";

test("official import review: only a designated catalog creator can inspect review candidates", async ({
  browser,
  page,
}) => {
  const admin = createE2eAdminClient();
  const creator = await provisionActor(admin, "e2e-import-review-creator");
  const viewer = await provisionActor(admin, "e2e-import-review-viewer");
  await grantCatalogCreator(admin, creator.userId);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const title = `E2E公式情報候補-${suffix}`;
  const sourceId = `event.e2e-review-${suffix}`;
  let viewerContext: BrowserContext | null = null;

  try {
    const { data: run, error: runError } = await admin
      .from("official_import_runs")
      .insert({ source_id: sourceId })
      .select("id")
      .single();
    if (runError || run === null) {
      throw new Error(
        `failed to seed import run: ${runError?.message ?? "unknown error"}`,
      );
    }

    const { data: candidate, error: candidateError } = await admin
      .from("official_import_candidates")
      .insert({
        run_id: run.id,
        source_id: sourceId,
        candidate_kind: "event",
        canonical_url: `https://example.test/events/${suffix}`,
        official_external_id: `official-${suffix}`,
        content_hash: "a".repeat(64),
        proposal_version: "event.v1",
        proposal: {
          sourceKey: `e2e:${suffix}`,
          title,
          venue: "E2E劇場",
          memo: null,
          sourceUrl: `https://example.test/events/${suffix}`,
          startsOn: "2026-10-01",
          endsOn: "2026-10-02",
          occurrences: [
            {
              doorsAt: "2026-10-01T09:30:00+09:00",
              startsAt: "2026-10-01T10:00:00+09:00",
              endsAt: "2026-10-01T12:30:00+09:00",
            },
          ],
        },
        evidence_locator: {
          sectionLabel: "E2E公演情報",
          rowLabel: title,
        },
        deterministic_match_status: "unmatched",
        semantic_match_status: "not_used",
        plan_summary: {
          version: "event_plan.v1",
          action: "create",
          detailsChanged: true,
          rangeChanged: true,
          newOccurrenceCount: 1,
          endsAtFixCount: 0,
          doorsAtFixCount: 0,
          keptOccurrenceCount: 0,
          genreChanged: false,
          groupsChanged: false,
        },
        plan_fingerprint: `e2e-plan-${suffix}`,
      })
      .select("id")
      .single();
    if (candidateError || candidate === null) {
      throw new Error(
        `failed to seed import candidate: ${candidateError?.message ?? "unknown error"}`,
      );
    }

    const { error: completionError } = await admin
      .from("official_import_runs")
      .update({ status: "completed", finished_at: new Date().toISOString() })
      .eq("id", run.id);
    if (completionError) {
      throw new Error(
        `failed to complete import run: ${completionError.message}`,
      );
    }

    await completeMagicLinkSignIn(page, creator.email);
    await page.goto("/catalog/imports");
    await expect(
      page.getByRole("heading", { name: "公式情報の確認" }),
    ).toBeVisible();
    const candidateCard = page
      .getByRole("heading", { name: title })
      .locator("xpath=ancestor::article");
    await expect(candidateCard).toBeVisible();
    await expect(
      candidateCard.getByRole("button", { name: "承認" }),
    ).toBeVisible();
    await expect(
      candidateCard.getByRole("button", { name: "却下" }),
    ).toBeVisible();
    await expect(
      candidateCard.getByText(/開演.*10:00.*終演.*12:30/),
    ).toBeVisible();
    await candidateCard.getByRole("button", { name: "承認" }).click();
    await expect(candidateCard.getByText("承認しました。")).toBeVisible();
    await expect(
      candidateCard.getByRole("button", { name: "承認" }),
    ).toBeDisabled();

    const { data: reviewed, error: reviewReadError } = await admin
      .from("official_import_candidates")
      .select("review_status, reviewer")
      .eq("id", candidate.id)
      .single();
    if (reviewReadError || reviewed === null) {
      throw new Error(
        `failed to verify review decision: ${reviewReadError?.message ?? "unknown error"}`,
      );
    }
    expect(reviewed).toMatchObject({
      review_status: "approved",
      reviewer: creator.userId,
    });

    viewerContext = await browser.newContext();
    const viewerPage = await viewerContext.newPage();
    await completeMagicLinkSignIn(viewerPage, viewer.email);
    await viewerPage.goto("/catalog/imports");
    await expect(
      viewerPage.getByText("公式情報を確認する権限がありません"),
    ).toBeVisible();
    await expect(viewerPage.getByText(title)).toHaveCount(0);
  } finally {
    await viewerContext?.close();
    // Completed runs and reviewed candidates are intentionally immutable. Local
    // E2E databases are reset between verification runs, so the candidate and
    // its reviewer actor remain until reset.
    await deleteActor(admin, viewer.userId);
  }
});
