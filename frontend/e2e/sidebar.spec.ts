import { type Page, expect, test } from "@playwright/test";
import { connectFixture, profileRow } from "./connect";

// ⌘B and the tab strip's button hide and show the sidebar, and the choice
// survives a reload; ⌘R puts focus in the result grid. Server mode, so the
// modifier is Ctrl (ControlOrMeta). On the fixture's table t
// (scripts/e2e.sh).

const db = process.env.QUEL_E2E_DB ?? "/tmp/quel-e2e.db";

const editor = (page: Page) => page.getByLabel("SQL editor");
const saved = (page: Page) => page.getByRole("list", { name: "Saved connections" });
const toggle = (page: Page) => page.getByRole("button", { name: "Sidebar", exact: true });
const grid = (page: Page) => page.getByRole("grid", { name: "Result" });
const resultTabs = (page: Page) => page.getByRole("tablist", { name: "Results" }).getByRole("tab");

// The save runs in the background: wait for its reply before a reload.
const saveDone = (page: Page) =>
  page.waitForResponse(
    (r) => r.url().endsWith("/wails/runtime") && (r.request().postData() ?? "").includes('"set-sidebar-hidden"'),
  );

// Specs share one app run and its settings, and later ones click sidebar
// rows: never leave the sidebar hidden.
test.afterEach(async ({ page }) => {
  if ((await toggle(page).count()) > 0 && (await toggle(page).getAttribute("aria-pressed")) === "false") {
    const done = saveDone(page);
    await toggle(page).click();
    await done;
  }
});

test("⌘B and the button hide and show the sidebar, and it stays hidden", async ({ page }) => {
  await connectFixture(page, db);
  await expect(saved(page)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");

  let done = saveDone(page);
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+b");
  await done;
  await expect(saved(page)).toHaveCount(0);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");

  // Still hidden after a reload, once a workspace shows.
  await page.reload();
  await expect(editor(page)).toBeVisible();
  await expect(saved(page)).toHaveCount(0);

  done = saveDone(page);
  await toggle(page).click();
  await done;
  await expect(saved(page)).toBeVisible();

  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.press("ControlOrMeta+b");
  await expect(saved(page)).toBeVisible();

  // Hidden with focus inside: focus goes to the editor.
  await profileRow(page, "E2E fixture").focus();
  await page.keyboard.press("ControlOrMeta+b");
  await expect(saved(page)).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
});

test("⌘R focuses the result grid, and does nothing on Messages", async ({ page }) => {
  await connectFixture(page, db);
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("select id, name from t where id <= 3 order by id;");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("gridcell", { name: "customer 3", exact: true })).toBeVisible();
  await expect(editor(page)).toBeFocused();

  // ⌘R must not reload the page in a browser.
  await page.evaluate(() => ((window as unknown as { noReload: boolean }).noReload = true));
  await page.keyboard.press("ControlOrMeta+r");
  await expect(grid(page)).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { noReload?: boolean }).noReload)).toBe(true);

  // The grid has the keyboard; ⌘E goes back.
  await page.keyboard.press("ArrowDown");
  await expect(grid(page).locator('[role="row"][aria-rowindex="2"]')).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ControlOrMeta+e");
  await expect(editor(page)).toBeFocused();

  // On Messages there is no grid: focus stays.
  await resultTabs(page).filter({ hasText: "Messages" }).click();
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+r");
  await expect(editor(page)).toBeFocused();
});
