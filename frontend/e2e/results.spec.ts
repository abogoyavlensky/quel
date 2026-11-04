import { type Page, expect, test } from "@playwright/test";
import { connectFixture } from "./connect";

// ⌘J, the tab strip's button and the Command Palette hide and show the
// results; a run and ⌘R bring them back. Server mode, so the modifier is
// Ctrl (ControlOrMeta). On the fixture's table t (scripts/e2e.sh). The
// choice lives in the page's memory, so specs clean up nothing.

const db = process.env.QUEL_E2E_DB ?? "/tmp/quel-e2e.db";

const editor = (page: Page) => page.getByLabel("SQL editor");
const pane = (page: Page) => page.getByRole("tablist", { name: "Results" });
const toggle = (page: Page) => page.getByRole("button", { name: "Results", exact: true });
const grid = (page: Page) => page.getByRole("grid", { name: "Result" });
const editorHeight = async (page: Page) =>
  (await page.locator('[data-slot="resizable-panel"]', { has: editor(page) }).last().boundingBox())!.height;

async function runQuery(page: Page) {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("select id, name from t where id <= 3 order by id;");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("gridcell", { name: "customer 3", exact: true })).toBeVisible();
}

test("⌘J hides and shows the results, the editor keeps focus and takes the room", async ({ page }) => {
  await connectFixture(page, db);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  const split = await editorHeight(page);

  // Ctrl+J must not reach the browser.
  await page.evaluate(() => ((window as unknown as { noReload: boolean }).noReload = true));
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+j");
  await expect(pane(page)).toHaveCount(0);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(editor(page)).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { noReload?: boolean }).noReload)).toBe(true);
  await expect.poll(() => editorHeight(page)).toBeGreaterThan(split * 2 - 2);

  await page.keyboard.press("ControlOrMeta+j");
  await expect(pane(page)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(editor(page)).toBeFocused();
});

test("the button hides and shows the results", async ({ page }) => {
  await connectFixture(page, db);
  await toggle(page).click();
  await expect(pane(page)).toHaveCount(0);
  await toggle(page).click();
  await expect(pane(page)).toBeVisible();
});

test("the button sits between the sidebar and row details buttons", async ({ page }) => {
  await connectFixture(page, db);
  const left = (await page.getByRole("button", { name: "Sidebar", exact: true }).boundingBox())!.x;
  const mid = (await toggle(page).boundingBox())!.x;
  const right = (await page.getByRole("button", { name: "Row details", exact: true }).boundingBox())!.x;
  expect(left).toBeLessThan(mid);
  expect(mid).toBeLessThan(right);
});

test("the Command Palette hides and shows the results", async ({ page }) => {
  await connectFixture(page, db);
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+Shift+p");
  await page.getByRole("option", { name: /Hide Results/ }).click();
  await expect(pane(page)).toHaveCount(0);
  await expect(editor(page)).toBeFocused();

  await page.keyboard.press("ControlOrMeta+Shift+p");
  await page.getByRole("option", { name: /Show Results/ }).click();
  await expect(pane(page)).toBeVisible();
});

test("a run brings the results back, with focus left in the editor", async ({ page }) => {
  await connectFixture(page, db);
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+j");
  await expect(pane(page)).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("select id, name from t where id <= 3 order by id;");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("gridcell", { name: "customer 3", exact: true })).toBeVisible();
  await expect(editor(page)).toBeFocused();
});

test("⌘R shows hidden results and focuses the grid", async ({ page }) => {
  await connectFixture(page, db);
  await runQuery(page);
  await page.keyboard.press("ControlOrMeta+j");
  await expect(pane(page)).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+r");
  await expect(grid(page)).toBeFocused();
});

test("hiding with focus in the grid moves focus to the editor", async ({ page }) => {
  await connectFixture(page, db);
  await runQuery(page);
  await page.keyboard.press("ControlOrMeta+r");
  await expect(grid(page)).toBeFocused();

  await page.keyboard.press("ControlOrMeta+j");
  await expect(pane(page)).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
});

test("a dragged split survives hiding the results", async ({ page }) => {
  await connectFixture(page, db);
  const before = await editorHeight(page);
  const box = (await page.getByRole("separator").last().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 90, { steps: 5 });
  await page.mouse.up();
  const dragged = await editorHeight(page);
  expect(Math.abs(dragged - before)).toBeGreaterThan(20);

  await toggle(page).click();
  await expect(pane(page)).toHaveCount(0);
  await toggle(page).click();
  await expect(pane(page)).toBeVisible();
  await expect.poll(() => editorHeight(page)).toBeCloseTo(dragged, 0);
});
