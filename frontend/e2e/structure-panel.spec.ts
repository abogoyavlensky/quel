import { type Page, expect, test } from "@playwright/test";
import { connectFixture } from "./connect";

// The Structure section folds to its header, and the choice survives a
// reload; the input above the tree filters it to the tables and views whose
// names match. On the fixture SQLite file (table t, scripts/e2e.sh), plus
// a table this spec makes. Other specs add tables to the same file: assert
// on presence, never on counts.

const db = process.env.QUEL_E2E_DB ?? "/tmp/quel-e2e.db";
const TABLE = "filter_e2e_orders";

const header = (page: Page) => page.getByRole("button", { name: "Structure", exact: true });
const tree = (page: Page) => page.getByRole("tree", { name: "Structure" });
const item = (page: Page, name: string) => tree(page).getByRole("treeitem", { name, exact: true });
const filterInput = (page: Page) => page.getByLabel("Filter structure");
const saved = (page: Page) => page.getByRole("list", { name: "Saved connections" });

const saveDone = (page: Page) =>
  page.waitForResponse(
    (r) => r.url().endsWith("/wails/runtime") && (r.request().postData() ?? "").includes('"set-structure-collapsed"'),
  );

// Specs share one app run and its settings: never leave the section collapsed.
test.afterEach(async ({ page }) => {
  if ((await header(page).count()) > 0 && (await header(page).getAttribute("aria-expanded")) === "false") {
    const done = saveDone(page);
    await header(page).click();
    await done;
  }
});

test("the Structure section collapses to its header, and stays collapsed", async ({ page }) => {
  await connectFixture(page, db);
  await expect(header(page)).toHaveAttribute("aria-expanded", "true");
  await expect(tree(page)).toBeVisible();

  let done = saveDone(page);
  await header(page).click();
  await done;
  await expect(header(page)).toHaveAttribute("aria-expanded", "false");
  await expect(tree(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh structure" })).toHaveCount(0);
  await expect(saved(page)).toBeVisible();

  await page.reload();
  await expect(saved(page)).toBeVisible();
  await expect(header(page)).toHaveAttribute("aria-expanded", "false");
  await expect(tree(page)).toHaveCount(0);

  // From the keyboard; focus stays on the header as it moves.
  done = saveDone(page);
  await header(page).focus();
  await page.keyboard.press("Enter");
  await done;
  await expect(header(page)).toHaveAttribute("aria-expanded", "true");
  await expect(header(page)).toBeFocused();
});

test("the filter narrows the tree to matching tables and views", async ({ page }) => {
  await connectFixture(page, db);
  const editor = page.getByLabel("SQL editor");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(`create table if not exists ${TABLE} (id integer);`);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("region", { name: "Statement outcome" })).toHaveText("Done");
  await page.getByRole("button", { name: "Refresh structure" }).click();
  await expect(item(page, TABLE)).toBeVisible();
  await expect(item(page, "t")).toBeVisible();

  await filterInput(page).fill("ORDERS");
  await expect(item(page, TABLE)).toBeVisible();
  await expect(item(page, "t")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(filterInput(page)).toHaveValue("");
  await expect(item(page, "t")).toBeVisible();

  await filterInput(page).fill("t");
  await expect(item(page, "t")).toBeVisible();
  await expect(item(page, TABLE)).toBeVisible();

  await filterInput(page).fill("nothing_matches_this");
  await expect(page.getByText("No tables or views match.")).toBeVisible();

  // ⌘F in the tree goes to the filter; ArrowDown from it, into the tree.
  await page.keyboard.press("Escape");
  await item(page, "t").click();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(filterInput(page)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(tree(page).getByRole("treeitem").first()).toBeFocused();
});

test("the filter finds tables in a closed schema, and leaves it closed", async ({ page }) => {
  await connectFixture(page, db);
  await expect(item(page, "main")).toHaveAttribute("aria-expanded", "true");
  await item(page, "main").click();
  await expect(item(page, "main")).toHaveAttribute("aria-expanded", "false");
  await expect(item(page, "t")).toHaveCount(0);

  await filterInput(page).fill("t");
  await expect(item(page, "main")).toHaveAttribute("aria-expanded", "true");
  await expect(item(page, "t")).toBeVisible();

  await filterInput(page).fill("");
  await expect(item(page, "main")).toHaveAttribute("aria-expanded", "false");
  await expect(item(page, "t")).toHaveCount(0);
});
