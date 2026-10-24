import { type Page, expect, test } from "@playwright/test";
import { ensureProfile, selectAndConnect } from "./connect";

// The structure tree and the editor's schema completion, on the fixture
// SQLite file (table t, made by scripts/e2e.sh). Metadata is cached per
// connection and reloads only with the refresh button.

const db = process.env.QUEL_E2E_DB ?? "/tmp/quel-e2e.db";

const tree = (page: Page) => page.getByRole("tree", { name: "Structure" });
const item = (page: Page, name: string) => tree(page).getByRole("treeitem", { name, exact: true });
// A column's row reads its name, then its type.
const column = (page: Page, name: string) => tree(page).getByRole("treeitem", { name: new RegExp(`^${name}\\s`) });

async function write(page: Page, sql: string) {
  await page.getByLabel("SQL editor").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);
}

async function runText(page: Page, sql: string) {
  await write(page, sql);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("status")).toHaveText("Ready");
}

// The completion options offered with the cursor after `before`.
async function completions(page: Page, before: string, after = "") {
  await write(page, before + after);
  for (let i = 0; i < after.length; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Control+Space");
  const options = page.locator(".cm-tooltip-autocomplete li");
  await options
    .first()
    .waitFor({ timeout: 3000 })
    .catch(() => {});
  const labels = await options.locator(".cm-completionLabel").allInnerTexts();
  await page.keyboard.press("Escape");
  return labels;
}

test("browse the structure, refresh it, and complete its names", async ({ page }) => {
  const name = `Structure ${Date.now()}`;
  const table = `structure_e2e_${Date.now()}`;
  await page.goto("/");
  await ensureProfile(page, name, db);
  await selectAndConnect(page, name);

  // The default schema opens by itself.
  await expect(item(page, "main")).toHaveAttribute("aria-expanded", "true");
  await expect(tree(page).getByRole("treeitem", { name: /^Tables/ })).toBeVisible();
  await expect(item(page, "t")).toHaveAttribute("aria-expanded", "false");

  // A table opens to its columns, with their types.
  await item(page, "t").click();
  await expect(item(page, "t")).toHaveAttribute("aria-expanded", "true");
  await expect(column(page, "id")).toContainText("INTEGER");
  await expect(column(page, "name")).toContainText("TEXT");

  // Columns complete after the table's name.
  expect(await completions(page, "select t.", " from t")).toEqual(expect.arrayContaining(["id", "name"]));

  // DDL does not refresh anything; the button does, tree and completion.
  await runText(page, `create table ${table} (a int)`);
  await expect(item(page, table)).toHaveCount(0);
  expect(await completions(page, "select * from structure_e2")).not.toContain(table);
  await page.getByRole("button", { name: "Refresh structure" }).click();
  await expect(item(page, table)).toBeVisible();
  expect(await completions(page, "select * from structure_e2")).toContain(table);

  // The keyboard: from the first column up to t, which closes, then out
  // to its group.
  await column(page, "id").click();
  await page.keyboard.press("ArrowUp");
  await expect(item(page, "t")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(item(page, "t")).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowLeft");
  await expect(tree(page).getByRole("treeitem", { name: /^Tables/ })).toBeFocused();

  await runText(page, `drop table ${table}`);

  // Disconnected, the tree gives way to a Connect button.
  await page.getByRole("button", { name: `Disconnect ${name}` }).click();
  await expect(page.getByText("Not connected.")).toBeVisible();
  await expect(tree(page)).toHaveCount(0);
});
