import { type Page, expect, test } from "@playwright/test";
import { expectConnected } from "./connect";

// Run policies on a SQLite profile: Read-only refuses a write before it is
// sent, Ask before changes asks first, and reads run straight away. The
// app runs with an empty data dir and in-memory secrets
// (scripts/server-mode.sh).

const db = process.env.QUEL_E2E_DB ?? "/tmp/quel-e2e.db";

const dialog = (page: Page) => page.getByRole("dialog");
const confirm = (page: Page) => page.getByRole("alertdialog");
const saved = (page: Page) => page.getByRole("list", { name: "Saved connections" });
const log = (page: Page) => page.getByRole("log", { name: "Messages" });

async function write(page: Page, sql: string) {
  await page.getByLabel("SQL editor").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);
}

async function setSafety(page: Page, label: string) {
  await dialog(page).getByRole("combobox", { name: "Safety" }).click();
  await page.getByRole("option", { name: label }).click();
}

test("read-only refuses writes; ask before changes asks", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New connection" }).first().click();
  await dialog(page).getByLabel("Name").fill("E2E guarded");
  await dialog(page).getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "SQLite" }).click();
  await dialog(page).getByLabel("File").fill(db);
  await setSafety(page, "Read-only");
  await expect(dialog(page)).toContainText("The database itself is not told.");
  await dialog(page).getByRole("button", { name: "Save" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole("banner")).toContainText("Read-only");

  await saved(page).getByRole("button", { name: "Connect E2E guarded" }).click();
  await expectConnected(page);

  // Read-only: the write is refused, with no question, and nothing ran.
  await write(page, "create table rp (a int)");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(log(page)).toContainText("E2E guarded is read-only");
  await expect(confirm(page)).toHaveCount(0);

  // Ask before changes.
  await saved(page).getByRole("button", { name: "Edit E2E guarded" }).click();
  await setSafety(page, "Ask before changes");
  await dialog(page).getByRole("button", { name: "Save" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole("banner")).toContainText("Asks before changes");

  // Cancel runs nothing; Run runs it.
  await page.getByLabel("SQL editor").click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(confirm(page)).toContainText("Run on E2E guarded?");
  await expect(confirm(page)).toContainText("create table rp (a int)");
  await confirm(page).getByRole("button", { name: "Cancel" }).click();
  await expect(confirm(page)).toHaveCount(0);
  await expect(log(page)).not.toContainText("Done");
  await page.getByLabel("SQL editor").click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await confirm(page).getByRole("button", { name: "Run" }).click();
  await expect(log(page)).toContainText("Done");

  // A read runs without asking.
  await write(page, "select count(*) as n from rp");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("gridcell", { name: "0", exact: true })).toBeVisible();
  await expect(confirm(page)).toHaveCount(0);

  // Clean up: drop the table (asked), then delete the profile.
  await write(page, "drop table rp");
  await page.keyboard.press("ControlOrMeta+Enter");
  await confirm(page).getByRole("button", { name: "Run" }).click();
  await expect(confirm(page)).toHaveCount(0);
  await saved(page).getByRole("button", { name: "Edit E2E guarded" }).click();
  await dialog(page).getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(saved(page).getByRole("button", { name: /^E2E guarded/ })).toHaveCount(0);
});
