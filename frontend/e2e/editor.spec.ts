import { type Page, expect, test } from "@playwright/test";
import { connectFixture, ensureProfile, profileRow } from "./connect";

// The editor itself: Tab, the block behind the statement ⌘↵ will run, the
// completion popup's icons, and the message on a profile that is not
// connected.

const db = process.env.QUEL_E2E_DB ?? "/tmp/quel-e2e.db";

const editor = (page: Page) => page.getByLabel("SQL editor");

// Replace the active editor's text. insertText, not typing: no
// autocompletion popup can swallow a key.
async function write(page: Page, sql: string) {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);
}

test("Tab accepts a completion, then indents", async ({ page }) => {
  await connectFixture(page, db);
  await write(page, "");
  await page.keyboard.type("sele");
  await expect(page.getByRole("listbox")).toBeVisible();
  // CodeMirror ignores an accept in the first 75ms of a popup (so a fast
  // typist does not accept by accident): a person is never that quick.
  await page.waitForTimeout(150);
  await page.keyboard.press("Tab");
  await expect(editor(page)).toHaveText("select");
  await expect(page.getByRole("listbox")).toHaveCount(0);

  await page.keyboard.press("Tab");
  // toHaveText ignores white space: read the raw text.
  await expect.poll(() => editor(page).textContent()).toMatch(/^\s+select$/);
});

test("a keyword in the popup has no icon", async ({ page }) => {
  await connectFixture(page, db);
  await write(page, "");
  await page.keyboard.type("sele");
  const icon = page.locator(".cm-completionIcon-keyword").first();
  // An empty slot: attached, but nothing to see.
  await expect(icon).toBeAttached();
  const content = await icon.evaluate((el) => getComputedStyle(el, "::after").content);
  expect(["", "none", '""']).toContain(content);
});

test("a table in the popup has its icon", async ({ page }) => {
  await connectFixture(page, db);
  // The completion schema loads after connecting: type until the table is offered.
  await write(page, "select * from ");
  await expect(async () => {
    await page.keyboard.type("t");
    await expect(page.locator(".cm-completionIcon-table").first()).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
  const content = await page
    .locator(".cm-completionIcon-table")
    .first()
    .evaluate((el) => getComputedStyle(el, "::after").content);
  expect(content).toContain("T");
});

test("the statement ⌘↵ will run has a block, and a selection has none", async ({ page }) => {
  await connectFixture(page, db);
  await write(page, "select 1;\n\nselect 2;");
  await expect(page.locator(".cm-currentStatement")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.locator(".cm-currentStatement")).toHaveCount(0);
});

test("an empty tab of a profile that is not connected says so", async ({ page }) => {
  await page.goto("/");
  await ensureProfile(page, "Editor offline", db);
  await profileRow(page, "Editor offline").click();
  await expect(page.getByText("Editor offline isn't connected.")).toBeVisible();
  await expect(page.getByText("Run the statement under the cursor")).toHaveCount(0);
  await page.getByRole("button", { name: "Connect to Editor offline" }).click();
  await expect(page.getByRole("status")).toHaveText("Ready");
  await expect(page.getByText("Run the statement under the cursor")).toBeVisible();
});
