import { type Page, expect, test } from "@playwright/test";
import { expectConnected } from "./connect";

// A tab whose connection the server drops (an idle-session timeout) gets a
// calm notice and a toast, both with Run again, and Run again works. Needs
// a Postgres: run under scripts/with-postgres.sh, which sets QUEL_PG_URL.
//
//   bash scripts/with-postgres.sh bash scripts/e2e.sh lost-connection.spec.ts

const pgUrl = process.env.QUEL_PG_URL ?? "";
test.skip(!pgUrl, "QUEL_PG_URL is unset: run under scripts/with-postgres.sh");

const dialog = (page: Page) => page.getByRole("dialog");
const saved = (page: Page) => page.getByRole("list", { name: "Saved connections" });
const outcome = (page: Page) => page.getByRole("region", { name: "Statement outcome" });
const log = (page: Page) => page.getByRole("log", { name: "Messages" });

async function run(page: Page, sql: string) {
  await page.getByLabel("SQL editor").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);
  await page.keyboard.press("ControlOrMeta+Enter");
}

test("a dropped connection is restored, and Run again runs it", async ({ page }) => {
  const u = new URL(pgUrl);
  await page.goto("/");
  await page.getByRole("button", { name: "New connection" }).first().click();
  await dialog(page).getByLabel("Name").fill("E2E postgres");
  await dialog(page).getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "PostgreSQL" }).click();
  await dialog(page).getByLabel("Host").fill(u.hostname);
  await dialog(page).getByLabel("Port").fill(u.port);
  await dialog(page).getByLabel("Database").fill(u.pathname.slice(1));
  await dialog(page).getByLabel("User").fill(decodeURIComponent(u.username));
  await dialog(page).getByLabel("Password").fill(decodeURIComponent(u.password));
  await dialog(page).getByRole("button", { name: "Save" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await saved(page).getByRole("button", { name: "Connect E2E postgres" }).click();
  await expectConnected(page);

  await run(page, "set idle_session_timeout = '1s'");
  await expect(outcome(page)).toContainText("Done");
  await page.waitForTimeout(2000);
  await run(page, "select 41 + 1 as answer");

  // The statement's own result tab shows the notice.
  await expect(outcome(page)).toContainText("Connection lost and restored. The statement was not run.");
  await expect(outcome(page)).toContainText("were reset");
  await expect(page.locator("[data-sonner-toast]", { hasText: "connection restored." })).toBeVisible();

  await outcome(page).getByRole("button", { name: "Run again" }).click();
  await expect(page.getByRole("grid")).toContainText("42");

  // Messages keeps it, without Run again now that the tab has moved on.
  await page.getByRole("tab", { name: "Messages" }).click();
  await expect(log(page)).toContainText("Connection lost and restored.");
  await expect(log(page).getByRole("button", { name: "Run again" })).toHaveCount(0);
});
