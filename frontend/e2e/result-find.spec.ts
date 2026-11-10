import { type Page, expect, test } from "@playwright/test";
import { connectFixture } from "./connect";

// Find in a result: ⌘F (Ctrl+F) while the grid has focus opens a bar over
// it; a match is a whole cell, over the loaded rows. On the fixture's
// table t (2,000 rows in 500-row pages).

const db = process.env.QUEL_E2E_DB ?? "/tmp/quel-e2e.db";

async function run(page: Page, sql: string) {
  await page.getByLabel("SQL editor").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);
  await page.keyboard.press("ControlOrMeta+Enter");
}

const grid = (page: Page) => page.getByRole("grid", { name: "Result" });
const field = (page: Page) => page.getByRole("textbox", { name: "Find in result" });
const count = (page: Page) => page.getByRole("search", { name: "Find in result" }).locator("[aria-live]");
const selected = (page: Page) => page.locator('[role="row"][aria-selected="true"]');

test("⌘F in the grid finds cells, steps between them and closes with Escape", async ({ page }) => {
  await connectFixture(page, db);
  await run(page, "select id, name from t where id <= 30 order by id;");
  await page.getByRole("gridcell", { name: "customer 1", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(field(page)).toBeFocused();

  await page.keyboard.type("customer 2");
  await expect(count(page)).toHaveText("11 matches");
  await page.keyboard.press("Enter");
  await expect(count(page)).toHaveText("1 of 11");
  await expect(selected(page)).toContainText("customer 2");
  await page.keyboard.press("Enter");
  await expect(count(page)).toHaveText("2 of 11");
  await expect(selected(page)).toContainText("customer 20");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.press("Shift+Enter");
  await expect(count(page)).toHaveText("11 of 11");
  await expect(selected(page)).toContainText("customer 29");

  await page.keyboard.press("Escape");
  await expect(field(page)).toHaveCount(0);
  await expect(grid(page)).toBeFocused();

  // The query comes back.
  await page.keyboard.press("ControlOrMeta+f");
  await expect(field(page)).toHaveValue("customer 2");
  await expect(field(page)).toBeFocused();
});

test("an open result says the count covers the loaded rows", async ({ page }) => {
  await connectFixture(page, db);
  await run(page, "select id, name from t order by id;");
  await page.getByRole("gridcell", { name: "customer 1", exact: true }).click();
  await page.keyboard.press("ControlOrMeta+f");
  await field(page).fill("customer 1999");
  await expect(count(page)).toHaveText("No results in loaded rows");
});

test("⌘F in the editor still opens the editor's Find", async ({ page }) => {
  await connectFixture(page, db);
  await run(page, "select id, name from t where id <= 3;");
  await expect(page.getByRole("gridcell", { name: "customer 3", exact: true })).toBeVisible();
  await page.getByLabel("SQL editor").click();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.getByRole("textbox", { name: "Find", exact: true })).toBeFocused();
  await expect(field(page)).toHaveCount(0);
});
