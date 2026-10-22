import { type Page, expect, test } from "@playwright/test";

// The query loop through the UI: open a SQLite file (2,000 rows in t,
// made by scripts/e2e.sh), run, page, pin, cancel, and one session per tab.

const db = process.env.QUEL_E2E_DB ?? "/tmp/quel-e2e.db";
const runaway =
  "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 1000000000) SELECT count(*) FROM c";

async function open(page: Page) {
  await page.goto("/");
  await page.getByLabel("File path or postgres:// URL").fill(db);
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("contentinfo")).toContainText(db);
}

// Replace the active editor's text. insertText, not typing: no
// autocompletion popup can swallow a key.
async function write(page: Page, sql: string) {
  await page.getByLabel("SQL editor").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);
}

const resultTabs = (page: Page) => page.getByRole("tablist", { name: "Results" }).getByRole("tab");
// The grid's footer: how many rows, and whether more can load. Scoped to
// the grid's container (CodeMirror has a live region of its own).
const footer = (page: Page) =>
  page.getByRole("grid", { name: "Result" }).locator("xpath=..").locator('[aria-live="polite"]');

test("runs the statement under the cursor and pages as it scrolls", async ({ page }) => {
  await open(page);
  await write(page, "select id, name from t order by id;");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByText("500 rows loaded, more available")).toBeVisible();
  await expect(page.getByRole("gridcell", { name: "customer 1", exact: true })).toBeVisible();

  const grid = page.getByRole("grid", { name: "Result" });
  await expect(async () => {
    await grid.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(footer(page)).toHaveText("2,000 rows", { timeout: 500 });
  }).toPass({ timeout: 20_000 });
  // The last page made the grid taller: scroll to its new end.
  await grid.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(page.getByRole("gridcell", { name: "customer 2000", exact: true })).toBeVisible();
});

test("a script gives each row-returning statement its own tab", async ({ page }) => {
  await open(page);
  await write(page, "select id from t limit 3; update t set name = name where id = 1; select name from t limit 2;");
  await page.keyboard.press("ControlOrMeta+Shift+Enter");
  await expect(resultTabs(page)).toHaveText(["Messages", "select id from t limit 3", "select name from t limit 2"]);
  await resultTabs(page).first().click();
  await expect(page.getByRole("log", { name: "Messages" })).toContainText("1 row affected");
});

test("a pinned result stays when the tab runs again", async ({ page }) => {
  await open(page);
  await write(page, "select id from t order by id;");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByText("500 rows loaded, more available")).toBeVisible();
  await page.getByRole("button", { name: "Pin result" }).click();

  await write(page, "select name from t limit 1;");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(resultTabs(page)).toHaveText(["Messages", "select id from t order by id", "select name from t limit 1"]);

  // Its cursor closed when the tab ran again: it keeps the rows it has.
  await resultTabs(page).nth(1).click();
  await expect(page.getByText("Showing 500 rows: run again for more")).toBeVisible();
});

test("cancel stops a runaway query", async ({ page }) => {
  await open(page);
  await write(page, `${runaway};`);
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("log", { name: "Messages" })).toContainText("Query canceled.");
  await expect(page.getByRole("status")).toHaveText("Ready");
});

test("each editor tab is its own session", async ({ page }) => {
  await open(page);
  await write(page, "create temp table only_here (x int);");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("log", { name: "Messages" })).toContainText("Done");

  await page.getByRole("button", { name: "New tab" }).click();
  await write(page, "select * from only_here;");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("log", { name: "Messages" })).toContainText("no such table: only_here");

  await page.getByRole("tab", { name: /Query 1/ }).click();
  await expect(page.getByLabel("SQL editor")).toHaveText("create temp table only_here (x int);");
  await write(page, "select count(*) from only_here;");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("gridcell", { name: "0", exact: true })).toBeVisible();
});
