import { type Page, expect, test } from "@playwright/test";
import { ensureProfile, selectAndConnect } from "./connect";

// Settings: ⌘, or the palette's Settings…, listing every command and its
// key. Server mode, so the modifier is Ctrl (ControlOrMeta) and the labels
// are Ctrl's. And the empty results pane points to the Command Palette.

const db = process.env.QUEL_E2E_DB ?? "/tmp/quel-e2e.db";

const editor = (page: Page) => page.getByLabel("SQL editor");
const settings = (page: Page) => page.getByRole("dialog", { name: "Settings" });
// By CSS: under a modal dialog the rest of the page is hidden from role queries.
const saved = (page: Page) => page.locator('[aria-label="Saved connections"]');

test("Settings lists the shortcuts, and the empty results point to the palette", async ({ page }) => {
  const name = `Settings ${Date.now()}`;
  await page.goto("/");
  await ensureProfile(page, name, db);
  await selectAndConnect(page, name);

  // Connected with nothing run: the hint under the run hint.
  await expect(page.getByText("All commands: Ctrl+Shift+P")).toBeVisible();

  // ⌘, opens it; the list has every command, with its key or none.
  await editor(page).focus();
  await page.keyboard.press("ControlOrMeta+,");
  await expect(settings(page)).toBeVisible();
  const row = (group: string, text: string) =>
    settings(page).getByRole("group", { name: group }).locator("div", { hasText: text }).last();
  await expect(row("View", "Command Palette…")).toContainText("Ctrl+Shift+P");
  await expect(row("Tabs", "Go to Tab 1–8")).toContainText("Ctrl+1–Ctrl+8");
  await expect(row("Connection", "Connect")).toContainText("—");

  // The app's keys are the dialog's while it is open: ⌘B leaves the sidebar.
  await page.keyboard.press("ControlOrMeta+b");
  await expect(saved(page)).toBeVisible();

  // Escape closes it, and focus goes back to the editor.
  await page.keyboard.press("Escape");
  await expect(settings(page)).toHaveCount(0);
  await expect(editor(page)).toBeFocused();

  // From another element, focus goes back there.
  const newTab = page.getByRole("button", { name: "New tab" });
  await newTab.focus();
  await page.keyboard.press("ControlOrMeta+,");
  await expect(settings(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings(page)).toHaveCount(0);
  await expect(newTab).toBeFocused();

  // The palette's Settings… opens it too; the palette leaves nothing to go
  // back to, so closing it puts focus in the editor.
  await page.keyboard.press("ControlOrMeta+Shift+p");
  await expect(page.getByRole("dialog", { name: "Command Palette" })).toBeVisible();
  await page.keyboard.type("Settings");
  await page.keyboard.press("Enter");
  await expect(settings(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings(page)).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
});
