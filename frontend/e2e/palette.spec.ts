import { type Page, expect, test } from "@playwright/test";
import { ensureProfile, profileRow } from "./connect";

// The two palettes and the keys that reach the editor and the tabs: ⌘P goes
// to a connection, ⇧⌘P runs a command, ⌘E and ⌘1–9 move to the editor and
// its tabs. Server mode, so the modifier is Ctrl (ControlOrMeta).

const db = process.env.QUEL_E2E_DB ?? "/tmp/quel-e2e.db";

const editor = (page: Page) => page.getByLabel("SQL editor");
const editorTabs = (page: Page) => page.getByRole("tablist", { name: "Editor tabs" }).getByRole("tab");
const tree = (page: Page) => page.getByRole("tree", { name: "Structure" });
const dialog = (page: Page, name: string) => page.getByRole("dialog", { name });

// Open a palette by its key, type, and pick the highlighted entry.
async function choose(page: Page, key: string, title: string, text: string) {
  await page.keyboard.press(key);
  await expect(dialog(page, title)).toBeVisible();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await expect(dialog(page, title)).toHaveCount(0);
}

test("palettes, the editor key and the tab keys", async ({ page }) => {
  // Profiles of their own, and a second one so the switch shows.
  const id = Date.now();
  const name = `Palette ${id}`;
  const other = `Other ${id}`;
  await page.goto("/");
  await ensureProfile(page, name, db);
  await ensureProfile(page, other, db);
  await profileRow(page, other).click();
  await expect(page.getByRole("banner")).toContainText(other);

  // ⌘P selects a connection and focuses its editor; it does not connect.
  await choose(page, "ControlOrMeta+p", "Go to Connection", name);
  await expect(page.getByRole("banner")).toContainText(name);
  await expect(editor(page)).toBeFocused();
  await expect(page.getByRole("status")).not.toHaveText("Ready");

  // ⇧⌘P → New Tab adds a tab, and the editor has focus.
  await expect(editorTabs(page)).toHaveCount(1);
  await choose(page, "ControlOrMeta+Shift+p", "Command Palette", "New Tab");
  await expect(editorTabs(page)).toHaveCount(2);
  await expect(editor(page)).toBeFocused();

  // ⇧⌘P → Connect connects the selected connection.
  await choose(page, "ControlOrMeta+Shift+p", "Command Palette", "Connect");
  await expect(page.getByRole("status")).toHaveText("Ready");
  // Connect does not move focus, so the palette gives it back.
  await expect(editor(page)).toBeFocused();

  // ⌘1 and ⌘2 pick a tab and focus its editor, from outside the editor too.
  await page.getByRole("button", { name: "New tab" }).focus();
  await page.keyboard.press("ControlOrMeta+1");
  await expect(editorTabs(page).first()).toHaveAttribute("aria-selected", "true");
  await expect(editor(page)).toBeFocused();
  await page.getByRole("button", { name: "New tab" }).focus();
  await page.keyboard.press("ControlOrMeta+2");
  await expect(editorTabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(editor(page)).toBeFocused();

  // ⌘9 is the last tab; a digit past the last tab does nothing.
  await page.keyboard.press("ControlOrMeta+1");
  await page.keyboard.press("ControlOrMeta+9");
  await expect(editorTabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ControlOrMeta+1");
  await page.keyboard.press("ControlOrMeta+5");
  await expect(editorTabs(page).first()).toHaveAttribute("aria-selected", "true");

  // ⌘E from the structure tree.
  const node = tree(page).getByRole("treeitem", { name: /^Tables/ });
  await node.click();
  await expect(node).toBeFocused();
  await page.keyboard.press("ControlOrMeta+e");
  await expect(editor(page)).toBeFocused();

  // Escape closes a palette, and focus goes back to where it was.
  await editor(page).focus();
  for (const key of ["ControlOrMeta+p", "ControlOrMeta+Shift+p"]) {
    await page.keyboard.press(key);
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(editor(page)).toBeFocused();
  }
  await node.click();
  await page.keyboard.press("ControlOrMeta+Shift+p");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(node).toBeFocused();

  // An entry that opens the profile dialog is not refused by the palette
  // that is closing; Escape closes the dialog.
  await page.keyboard.press("ControlOrMeta+Shift+p");
  await page.keyboard.type("New Connection");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Name")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
