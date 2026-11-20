import { type Page, expect, test } from "@playwright/test";
import { connectFixture } from "./connect";

// The queries Quel itself sends show in Messages, merged in by time and
// shown by default: the catalog reads behind the structure tree and
// completion (SQLite's pragmas here). The header's checkbox or the palette
// hides them, and the choice holds across a reload.

const db = process.env.QUEL_E2E_DB ?? "/tmp/quel-e2e.db";

const log = (page: Page) => page.getByRole("log", { name: "Messages" });
const quel = (page: Page) => log(page).getByRole("group", { name: "Quel's query" });
const tree = (page: Page) => page.getByRole("tree", { name: "Structure" });
const item = (page: Page, name: string) => tree(page).getByRole("treeitem", { name, exact: true });
const toggle = (page: Page) => page.getByLabel("Show Quel's queries");

async function palette(page: Page, text: string) {
  await page.keyboard.press("ControlOrMeta+Shift+P");
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

test("Quel's own queries show in Messages, and hide", async ({ page }) => {
  await connectFixture(page, db);
  await page.getByRole("tab", { name: "Messages" }).click();
  await expect(toggle(page)).toBeChecked();

  // Opening a table reads its columns, keys and indexes.
  const before = await quel(page).count();
  await item(page, "t").click();
  await expect(item(page, "t")).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => quel(page).count()).toBeGreaterThan(before);
  const entry = quel(page).filter({ hasText: /pragma/i }).last();
  await expect(entry).toContainText(/\d+ rows? in \d+ ms/);
  await expect(entry).toContainText("Parameters: ");

  // Opening an entry shows its full SQL.
  const full = entry.locator("pre");
  await expect(full).toBeHidden();
  await entry.locator("summary").click();
  await expect(full).toBeVisible();
  await expect(full).toContainText(/pragma/i);

  // The checkbox hides them; the choice is saved.
  await toggle(page).click();
  await expect(toggle(page)).not.toBeChecked();
  await expect(quel(page)).toHaveCount(0);
  await page.reload();
  await connectFixture(page, db);
  await page.getByRole("tab", { name: "Messages" }).click();
  await expect(toggle(page)).not.toBeChecked();

  // The palette shows them again.
  await palette(page, "Show Quel's Queries");
  await expect(toggle(page)).toBeChecked();
  await expect.poll(() => quel(page).count()).toBeGreaterThan(0);
});
