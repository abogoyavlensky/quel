import { type Page, expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { connectFixture } from "./connect";

// Exporting a result: the Export popover copies it as CSV, JSON or a
// Markdown table, or saves it (in server mode a browser download, as the
// native dialog needs the app). On the fixture's table t, 2,000 rows.

const db = process.env.QUEL_E2E_DB ?? "/tmp/quel-e2e.db";

async function write(page: Page, sql: string) {
  await page.getByLabel("SQL editor").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);
}

async function run(page: Page, sql: string) {
  await write(page, sql);
  await page.keyboard.press("ControlOrMeta+Enter");
}

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
const popover = (page: Page) => page.getByRole("dialog");
const format = (page: Page, name: string) => popover(page).getByRole("radio", { name, exact: true });

async function openExport(page: Page) {
  await page.getByRole("button", { name: "Export" }).click();
  await expect(popover(page)).toBeVisible();
}

// Pick a format, copy, and wait for the popover to close.
async function copyAs(page: Page, name: string) {
  await openExport(page);
  await format(page, name).click();
  await popover(page).getByRole("button", { name: "Copy" }).click();
  await expect(popover(page)).toHaveCount(0);
}

const small = "select id, name, null as gone from t where id <= 2 order by id";

test("copies a result as CSV, JSON and Markdown", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await connectFixture(page, db);
  await run(page, small);
  await expect(page.getByRole("gridcell", { name: "customer 2", exact: true })).toBeVisible();

  await copyAs(page, "CSV");
  await expect(page.getByText("Copied 2 rows as CSV")).toBeVisible();
  expect(await clipboard(page)).toBe("id,name,gone\r\n1,customer 1,\r\n2,customer 2,\r\n");

  await copyAs(page, "JSON");
  await expect(page.getByText("Copied 2 rows as JSON")).toBeVisible();
  expect(JSON.parse(await clipboard(page))).toEqual([
    { id: 1, name: "customer 1", gone: null },
    { id: 2, name: "customer 2", gone: null },
  ]);

  await copyAs(page, "Markdown");
  await expect(page.getByText("Copied 2 rows as Markdown")).toBeVisible();
  expect(await clipboard(page)).toBe(
    "| id | name | gone |\n| ---: | --- | --- |\n| 1 | customer 1 | *NULL* |\n| 2 | customer 2 | *NULL* |\n",
  );
});

test("the export's notice can be closed", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await connectFixture(page, db);
  await run(page, small);
  await expect(page.getByRole("gridcell", { name: "customer 2", exact: true })).toBeVisible();

  await copyAs(page, "CSV");
  const notice = page.locator("[data-sonner-toast]", { hasText: "Copied 2 rows as CSV" });
  await expect(notice).toBeVisible();
  await notice.hover();
  await notice.getByRole("button", { name: "Close toast" }).click();
  await expect(notice).toHaveCount(0);
});

test("reopens on the last format", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await connectFixture(page, db);
  await run(page, small);
  await expect(page.getByRole("gridcell", { name: "customer 2", exact: true })).toBeVisible();

  await copyAs(page, "JSON");
  await openExport(page);
  await expect(format(page, "JSON")).toHaveAttribute("aria-checked", "true");
  // The separator is for CSV only.
  await expect(popover(page).getByRole("combobox", { name: "Separator" })).toHaveCount(0);
});

test("saves a CSV with the chosen separator as a download", async ({ page }) => {
  await connectFixture(page, db);
  await run(page, small);
  await expect(page.getByRole("gridcell", { name: "customer 2", exact: true })).toBeVisible();

  await openExport(page);
  await format(page, "CSV").click();
  await popover(page).getByRole("combobox", { name: "Separator" }).click();
  await page.getByRole("option", { name: "Semicolon" }).click();
  const download = page.waitForEvent("download");
  await popover(page).getByRole("button", { name: "Save…" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^result-\d{4}-\d{2}-\d{2}-\d{4}\.csv$/);
  expect(readFileSync((await file.path()) as string, "utf8")).toBe("id;name;gone\r\n1;customer 1;\r\n2;customer 2;\r\n");
});

test("loads the rest of an open result before exporting it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await connectFixture(page, db);
  await run(page, "select id from t order by id");
  // 2,000 rows, 500 a page: the cursor starts open.
  await expect(page.getByText(/rows loaded, (more available|loading more)/)).toBeVisible();

  await copyAs(page, "CSV");
  await expect(page.getByText("Copied 2,000 rows as CSV")).toBeVisible();
  const lines = (await clipboard(page)).split("\r\n");
  // The header, 2,000 rows, and the empty piece after the last CRLF.
  expect(lines).toHaveLength(2002);
  expect(lines[1]).toBe("1");
  expect(lines[2000]).toBe("2000");
  await expect(page.getByText("2,000 rows", { exact: true })).toBeVisible();
});
