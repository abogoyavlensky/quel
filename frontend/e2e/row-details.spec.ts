import { type Page, expect, test } from "@playwright/test";
import { connectFixture } from "./connect";

// The row details panel: select a row in the grid, open the panel three
// ways, read the values (JSON formatted from its own text), copy them, and
// filter the columns. On the fixture's table t (scripts/e2e.sh).

const db = process.env.QUEL_E2E_DB ?? "/tmp/quel-e2e.db";
const doc = '{"n":1.10,"big":12345678901234567890,"tags":["x","y"]}';

async function write(page: Page, sql: string) {
  await page.getByLabel("SQL editor").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);
}

const grid = (page: Page) => page.getByRole("grid", { name: "Result" });
// A data row by its 1-based number (aria-rowindex counts the header as 1).
const row = (page: Page, n: number) => grid(page).locator(`[role="row"][aria-rowindex="${n + 1}"]`);
const details = (page: Page) => page.getByRole("complementary", { name: "Row details" });
const field = (page: Page, name: string) => details(page).getByRole("group", { name, exact: true });

test("shows, copies and filters the selected row's values", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await connectFixture(page, db);
  await write(page, `select id, name, '${doc}' as doc, null as gone from t where id <= 3 order by id;`);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("gridcell", { name: "customer 3", exact: true })).toBeVisible();

  // A click selects; the panel stays closed.
  await row(page, 2).click();
  await expect(row(page, 2)).toHaveAttribute("aria-selected", "true");
  await expect(details(page)).toHaveCount(0);

  // The toggle opens it on the selected row.
  await page.getByRole("button", { name: "Row details" }).click();
  await expect(details(page)).toContainText("Row 2 of 3");
  await expect(field(page, "name")).toContainText("customer 2");
  const docText = await field(page, "doc").innerText();
  expect(docText).toContain('"n": 1.10,\n');
  expect(docText).toContain('"big": 12345678901234567890,\n');
  await expect(field(page, "gone")).toContainText("NULL");
  await expect(field(page, "gone").getByRole("button", { name: "Copy gone" })).toBeDisabled();

  // The toggle took focus: click the row again, then ↓.
  await row(page, 2).click();
  await page.keyboard.press("ArrowDown");
  await expect(details(page)).toContainText("Row 3 of 3");
  await expect(field(page, "name")).toContainText("customer 3");

  // A value copies as stored; the row as JSON.
  await field(page, "doc").hover();
  await field(page, "doc").getByRole("button", { name: "Copy doc" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(doc);
  await details(page).getByRole("button", { name: "Copy row as JSON" }).click();
  await expect
    .poll(async () => JSON.parse(await page.evaluate(() => navigator.clipboard.readText())))
    .toEqual({ id: 3, name: "customer 3", doc, gone: null });

  // The filter matches column names.
  await details(page).getByLabel("Filter columns").fill("na");
  await expect(details(page).getByRole("group")).toHaveCount(1);
  await expect(field(page, "name")).toBeVisible();
  await details(page).getByLabel("Filter columns").fill("");

  // The key closes it, even from the editor, and leaves the text alone.
  const sql = await page.getByLabel("SQL editor").innerText();
  await page.getByLabel("SQL editor").click();
  await page.keyboard.press("ControlOrMeta+i");
  await expect(details(page)).toHaveCount(0);
  await expect(page.getByLabel("SQL editor")).toHaveText(sql);

  // A double-click opens it on that row.
  await row(page, 1).dblclick();
  await expect(details(page)).toContainText("Row 1 of 3");

  // It follows the result tab and the editor tab.
  const resultTabs = page.getByRole("tablist", { name: "Results" }).getByRole("tab");
  await resultTabs.first().click();
  await expect(details(page)).toContainText("Select a row to see its values.");
  await resultTabs.nth(1).click();
  await expect(details(page)).toContainText("Row 1 of 3");
  await page.getByRole("button", { name: "New tab" }).click();
  await expect(details(page)).toContainText("Select a row to see its values.");
  await page.getByRole("tablist", { name: "Editor tabs" }).getByRole("tab").first().click();
  await expect(details(page)).toContainText("Row 1 of 3");
});
