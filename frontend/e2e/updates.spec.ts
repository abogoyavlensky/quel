import { type Page, expect, test } from "@playwright/test";

// A newer version from the stub GitHub that scripts/e2e.sh starts: the
// status bar offers it, the dialog explains that server mode can't
// install it (the brew command), and a skip lasts across a reload. Each
// run serves a version of its own, so a retry isn't hidden by an earlier
// run's skip.

const github = process.env.QUEL_E2E_GITHUB ?? "http://127.0.0.1:9";

// The next check-update call's reply. The first check runs 10 s after the
// page loads.
const nextCheck = (page: Page) =>
  page.waitForResponse(
    (r) => r.url().endsWith("/wails/runtime") && (r.request().postData() ?? "").includes('"check-update"'),
    { timeout: 20_000 },
  );

const updateButton = (page: Page) => page.getByRole("contentinfo").getByRole("button");

test("a newer version is offered, explained and skipped", async ({ page, request }) => {
  test.setTimeout(60_000);
  const version = `99.0.${Date.now() % 100_000}`;
  await request.post(`${github}/_version`, { data: version });

  const checked = nextCheck(page);
  await page.goto("/");
  await checked;
  await expect(updateButton(page)).toHaveText("Update");

  await updateButton(page).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`Quel ${version} is available.`);
  await expect(dialog).toContainText("brew upgrade --cask quel");
  await expect(dialog.getByRole("button", { name: "Open Release Page" })).toBeVisible();

  await dialog.getByRole("button", { name: "Skip This Version" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(updateButton(page)).toHaveCount(0);

  const again = nextCheck(page);
  await page.reload();
  await again;
  await expect(updateButton(page)).toHaveCount(0);
});
