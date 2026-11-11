import { type Page, expect, test } from "@playwright/test";
import { connectFixture } from "./connect";

// The result tab strip from the keyboard and the mouse: ⌘PageUp and
// ⌘PageDown cycle the tabs of the focused area (results or editor), and a
// kept result tab drags to a new place. Server mode, so the modifier is
// Ctrl (ControlOrMeta). On the fixture's database (scripts/e2e.sh).

const db = process.env.QUEL_E2E_DB ?? "/tmp/quel-e2e.db";

const editor = (page: Page) => page.getByLabel("SQL editor");
const grid = (page: Page) => page.getByRole("grid", { name: "Result" });
const resultTabs = (page: Page) => page.getByRole("tablist", { name: "Results" }).getByRole("tab");
const editorTabs = (page: Page) => page.getByRole("tablist", { name: "Editor tabs" }).getByRole("tab");

// Runs the editor's text as a script: one result tab per statement.
async function runScript(page: Page, sql: string) {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);
  await page.keyboard.press("ControlOrMeta+Shift+Enter");
}

const three = "select 1 as a; select 2 as b; select 3 as c;";

async function runThree(page: Page) {
  await runScript(page, three);
  await expect(resultTabs(page)).toHaveCount(4);
  await expect(resultTabs(page).nth(3)).toHaveAttribute("aria-selected", "true");
}

test("⌘PageUp and ⌘PageDown cycle the focused area's tabs", async ({ page }) => {
  await connectFixture(page, db);
  await runThree(page);

  // In the results: from the third result to Messages (no grid: its tab
  // takes focus), to the first result (its grid), and back.
  await page.keyboard.press("ControlOrMeta+r");
  await expect(grid(page)).toBeFocused();
  await page.keyboard.press("ControlOrMeta+PageDown");
  await expect(resultTabs(page).first()).toHaveAttribute("aria-selected", "true");
  await expect(resultTabs(page).first()).toBeFocused();
  await page.keyboard.press("ControlOrMeta+PageDown");
  await expect(resultTabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(grid(page)).toBeFocused();
  await page.keyboard.press("ControlOrMeta+PageUp");
  await page.keyboard.press("ControlOrMeta+PageUp");
  await expect(resultTabs(page).nth(3)).toHaveAttribute("aria-selected", "true");
  await expect(grid(page)).toBeFocused();

  // In the editor: the editor tabs.
  await page.getByRole("button", { name: "New tab" }).click();
  await expect(editorTabs(page)).toHaveCount(2);
  await expect(editorTabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+PageUp");
  await expect(editorTabs(page).first()).toHaveAttribute("aria-selected", "true");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press("ControlOrMeta+PageDown");
  await expect(editorTabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(editor(page)).toBeFocused();
});
