import { type Page, expect, test } from "@playwright/test";

// Saved connections through the UI: create a SQLite profile in the dialog,
// test it before saving, connect it, run, rename and delete it. The app
// runs with an empty data dir and in-memory secrets (scripts/server-mode.sh).

const db = process.env.QUEL_E2E_DB ?? "/tmp/quel-e2e.db";

const dialog = (page: Page) => page.getByRole("dialog");
const saved = (page: Page) => page.getByRole("list", { name: "Saved connections" });

// Replace the active editor's text (see query-loop.spec.ts).
async function write(page: Page, sql: string) {
  await page.getByLabel("SQL editor").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);
}

test("a profile is tested before saving, then connected, renamed and deleted", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New connection" }).first().click();
  await expect(dialog(page)).toContainText("New Connection");

  await dialog(page).getByLabel("Name").fill("E2E file");
  await dialog(page).getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "SQLite" }).click();

  // A wrong path fails the test, and nothing is saved.
  await dialog(page).getByLabel("File").fill(`${db}.missing`);
  await dialog(page).getByRole("button", { name: "Test" }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("No such file");
  await expect(page.getByRole("button", { name: /^E2E file/ })).toHaveCount(0);

  // Editing clears the result; the right path passes.
  await dialog(page).getByLabel("File").fill(db);
  await expect(dialog(page).getByRole("alert")).toHaveCount(0);
  await dialog(page).getByRole("radio", { name: "green" }).click();
  await dialog(page).getByRole("button", { name: "Test" }).click();
  await expect(dialog(page)).toContainText("Connected");
  await dialog(page).getByRole("button", { name: "Save" }).click();
  await expect(dialog(page)).toHaveCount(0);

  // Listed; a click connects it, and the status bar shows its name.
  await saved(page)
    .getByRole("button", { name: /^E2E file/ })
    .click();
  await expect(page.getByRole("contentinfo")).toContainText("E2E file");
  await write(page, "select count(*) as n from t;");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("gridcell", { name: "2000", exact: true })).toBeVisible();

  // Disconnect, and connect again.
  await saved(page).getByRole("button", { name: "Disconnect E2E file" }).click();
  await expect(page.getByRole("contentinfo")).toContainText("No database");
  await saved(page)
    .getByRole("button", { name: /^E2E file/ })
    .click();
  await expect(page.getByRole("contentinfo")).toContainText("E2E file");

  // Renamed: the list and the open connection follow.
  await saved(page).getByRole("button", { name: "Edit E2E file" }).click();
  await dialog(page).getByLabel("Name").fill("E2E renamed");
  await dialog(page).getByRole("button", { name: "Save" }).click();
  await expect(saved(page).getByRole("button", { name: /^E2E renamed/ })).toBeVisible();
  await expect(page.getByRole("contentinfo")).toContainText("E2E renamed");

  // Deleted through the confirm: it disconnects and leaves the list.
  await saved(page).getByRole("button", { name: "Edit E2E renamed" }).click();
  await dialog(page).getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: /^E2E renamed/ })).toHaveCount(0);
  await expect(page.getByRole("contentinfo")).toContainText("No database");
});

test("a duplicate name is refused", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New connection" }).first().click();
  await dialog(page).getByLabel("Name").fill("Dup");
  await dialog(page).getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "SQLite" }).click();
  await dialog(page).getByLabel("File").fill(db);
  await dialog(page).getByRole("button", { name: "Save" }).click();
  await expect(saved(page).getByRole("button", { name: /^Dup/ })).toBeVisible();

  await page.getByRole("button", { name: "New connection" }).first().click();
  await dialog(page).getByLabel("Name").fill("dup");
  await dialog(page).getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "SQLite" }).click();
  await dialog(page).getByLabel("File").fill(db);
  await dialog(page).getByRole("button", { name: "Save" }).click();
  await expect(dialog(page).getByRole("alert")).toHaveText("A connection named dup already exists.");
  await dialog(page).getByRole("button", { name: "Cancel" }).click();

  // Clean up for whatever runs next in this app.
  await saved(page).getByRole("button", { name: "Edit Dup" }).click();
  await dialog(page).getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(saved(page).getByRole("button", { name: /^Dup/ })).toHaveCount(0);
});
