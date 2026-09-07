import { expect, test } from "@playwright/test";

test("placeholder home page shows the heading and the ping button", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "stage-tracker v2" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "pingAction を実行" }),
  ).toBeVisible();
});
