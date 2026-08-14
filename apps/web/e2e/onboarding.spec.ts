import { expect, test } from "@playwright/test";

test("pastes a personal access token in settings", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("button", { name: /settings/i }).click();
  await page.getByLabel("Personal Access Token").fill("vb_pat_playwrighttokenxxxxxxxxxxxx");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Settings updated.")).toBeVisible();
});
