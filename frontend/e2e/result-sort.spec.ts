import { type Page, expect, test } from "@playwright/test";
import { connectFixture } from "./connect";

// Sorting a result by a header click, in the app: ascending, descending,
// then the order the rows came in. On the fixture's table t: 2,000 rows in
// 500-row pages, so the first page leaves the cursor open and a sort loads
// the rest first.

const db = process.env.QUEL_E2E_DB ?? "/tmp/quel-e2e.db";

async function run(page: Page, sql: string) {
  await page.getByLabel("SQL editor").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);
  await page.keyboard.press("ControlOrMeta+Enter");
}

const header = (page: Page, name: string) => page.getByRole("columnheader", { name: new RegExp(`^${name}`) });
// The first data row's first cell.
const firstId = (page: Page) => page.locator('[role="row"][aria-rowindex="2"] [role="gridcell"]').first();
const footer = (page: Page) => page.getByRole("group", { name: "Result footer" });

test("a header click sorts every row: ascending, descending, then as they came", async ({ page }) => {
  await connectFixture(page, db);
  await run(page, "select id, name from t order by id;");
  await expect(firstId(page)).toHaveText("1");
  await expect(footer(page)).toContainText("500 rows loaded");

  await header(page, "id").click();
  await expect(header(page, "id")).toHaveAttribute("aria-sort", "ascending");
  await expect(firstId(page)).toHaveText("1");
  // The rest loaded first.
  await expect(footer(page)).toContainText("2,000 rows");

  await header(page, "id").click();
  await expect(header(page, "id")).toHaveAttribute("aria-sort", "descending");
  await expect(firstId(page)).toHaveText("2000");

  await header(page, "id").click();
  await expect(header(page, "id")).toHaveAttribute("aria-sort", "none");
  await expect(firstId(page)).toHaveText("1");
});

test("resizing a column does not sort it", async ({ page }) => {
  await connectFixture(page, db);
  await run(page, "select id, name from t where id <= 3;");
  await expect(firstId(page)).toHaveText("1");
  const handle = header(page, "name").locator("div[aria-hidden]");
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await page.mouse.up();
  await expect(header(page, "name")).toHaveAttribute("aria-sort", "none");
});

test("export follows the shown order", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await connectFixture(page, db);
  await run(page, "select id, name from t where id <= 3 order by id;");
  await expect(firstId(page)).toHaveText("1");
  await header(page, "id").click();
  await header(page, "id").click();
  await expect(firstId(page)).toHaveText("3");

  await page.getByRole("button", { name: "Export" }).click();
  const popover = page.getByRole("dialog");
  await popover.getByRole("radio", { name: "CSV", exact: true }).click();
  await popover.getByRole("button", { name: "Copy" }).click();
  await expect(page.getByText("Copied 3 rows as CSV")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "id,name\r\n3,customer 3\r\n2,customer 2\r\n1,customer 1\r\n",
  );
});
