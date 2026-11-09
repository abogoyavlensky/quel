import { type Page, expect, test } from "@playwright/test";
import { connectFixture, ensureProfile, profileRow } from "./connect";

// The editor's Find and Go to Line panels: our controls in CodeMirror
// panels docked at the top, one open at a time, clear of the Run button.

const db = process.env.QUEL_E2E_DB ?? "/tmp/quel-e2e.db";

const editor = (page: Page) => page.getByLabel("SQL editor");
const findField = (page: Page) => page.getByRole("textbox", { name: "Find" });
const replaceField = (page: Page) => page.getByRole("textbox", { name: "Replace", exact: true });
const goToField = (page: Page) => page.getByRole("textbox", { name: "Go to line" });
const count = (page: Page) => page.locator(".cm-search [aria-live]");
const lines = (page: Page) => page.locator(".cm-line");

const sql = "select 1;\nselect 2;\nselect 3;";

// Replace the active editor's text. insertText, not typing: no
// autocompletion popup can swallow a key.
async function write(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}

test("⌘F opens Find at the top, focused, and counts matches", async ({ page }) => {
  await connectFixture(page, db);
  await write(page, sql);
  await page.keyboard.press("ControlOrMeta+f");
  await expect(findField(page)).toBeFocused();
  await expect(page.locator(".cm-panels-top .cm-search")).toBeVisible();

  await page.keyboard.type("select");
  await expect(count(page)).toHaveText("3 matches");
  await page.keyboard.press("Enter");
  await expect(count(page)).toHaveText("1 of 3");
  await page.keyboard.press("Shift+Enter");
  await expect(count(page)).toHaveText("3 of 3");
  await findField(page).fill("zzz");
  await expect(count(page)).toHaveText("No results");

  // ⌘F in the field keeps it and selects its text.
  await page.keyboard.press("ControlOrMeta+f");
  await expect(findField(page)).toBeFocused();
  expect(await findField(page).evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 3]);

  // Escape closes it and gives the editor its focus back.
  await page.keyboard.press("Escape");
  await expect(findField(page)).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
});

test("replace folds out and Replace all rewrites every match", async ({ page }) => {
  await connectFixture(page, db);
  await write(page, sql);
  await page.keyboard.press("ControlOrMeta+f");
  await findField(page).fill("select");
  await expect(replaceField(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle replace" }).click();
  await replaceField(page).fill("SELECT");
  await page.getByRole("button", { name: "Replace all" }).click();
  await expect(lines(page)).toHaveText(["SELECT 1;", "SELECT 2;", "SELECT 3;"]);
});

test("an invalid regular expression marks the field", async ({ page }) => {
  await connectFixture(page, db);
  await write(page, sql);
  await page.keyboard.press("ControlOrMeta+f");
  await page.getByRole("button", { name: "Use regular expression" }).click();
  await findField(page).fill("(");
  await expect(findField(page)).toHaveAttribute("aria-invalid", "true");
  await expect(count(page)).toHaveText("");
});

test("⌘⌥G goes to a line", async ({ page }) => {
  await connectFixture(page, db);
  await write(page, sql);
  await page.keyboard.press("ControlOrMeta+Alt+g");
  await expect(goToField(page)).toBeFocused();
  await expect(page.locator(".cm-panels-top .cm-goto-line")).toBeVisible();
  await page.keyboard.type("2");
  await page.keyboard.press("Enter");
  await expect(goToField(page)).toHaveCount(0);
  await page.keyboard.type("x");
  await expect(lines(page).nth(1)).toHaveText("xselect 2;");
});

test("a target that does not parse keeps Go to Line open and marked", async ({ page }) => {
  await connectFixture(page, db);
  await write(page, sql);
  await page.keyboard.press("ControlOrMeta+Alt+g");
  await goToField(page).fill("abc");
  await page.keyboard.press("Enter");
  await expect(goToField(page)).toHaveAttribute("aria-invalid", "true");
});

test("Find and Go to Line close each other", async ({ page }) => {
  await connectFixture(page, db);
  await write(page, sql);
  await page.keyboard.press("ControlOrMeta+f");
  await expect(findField(page)).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Alt+g");
  await expect(findField(page)).toHaveCount(0);
  await expect(goToField(page)).toBeFocused();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(goToField(page)).toHaveCount(0);
  await expect(findField(page)).toBeFocused();
});

test("⌘G with nothing searched opens Find in place of Go to Line", async ({ page }) => {
  await connectFixture(page, db);
  await write(page, sql);
  await page.keyboard.press("ControlOrMeta+Alt+g");
  await expect(goToField(page)).toBeFocused();
  await page.keyboard.press("ControlOrMeta+g");
  await expect(goToField(page)).toHaveCount(0);
  await expect(findField(page)).toBeFocused();
});

test("the Find panel's close button is clear of the Run button", async ({ page }) => {
  await connectFixture(page, db);
  await write(page, sql);
  await page.keyboard.press("ControlOrMeta+f");
  const close = await page.getByRole("button", { name: "Close find" }).boundingBox();
  const run = await page.getByRole("button", { name: "Run" }).boundingBox();
  expect(close && run).toBeTruthy();
  const overlap =
    close!.x < run!.x + run!.width &&
    run!.x < close!.x + close!.width &&
    close!.y < run!.y + run!.height &&
    run!.y < close!.y + close!.height;
  expect(overlap).toBe(false);
});

test("a tab switch keeps Find open and the caret in the editor", async ({ page }) => {
  // A profile of its own: the extra tab stays out of the other specs.
  const name = `Search ${Date.now()}`;
  await page.goto("/");
  await ensureProfile(page, name, db);
  await profileRow(page, name).click();
  await write(page, sql);
  await page.keyboard.press("ControlOrMeta+f");
  await page.keyboard.type("select");

  await page.getByRole("button", { name: "New tab" }).click();
  await expect(findField(page)).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+1");
  await expect(findField(page)).toHaveValue("select");
  await expect(editor(page)).toBeFocused();
});

test("Enter on Go to Line's close button closes it without moving the cursor", async ({ page }) => {
  await connectFixture(page, db);
  await write(page, sql);
  await page.keyboard.press("ControlOrMeta+Alt+g");
  await goToField(page).fill("1");
  await page.getByRole("button", { name: "Close go to line" }).focus();
  await page.keyboard.press("Enter");
  await expect(goToField(page)).toHaveCount(0);
  await page.keyboard.type("x");
  await expect(lines(page).nth(2)).toHaveText("select 3;x");
});
