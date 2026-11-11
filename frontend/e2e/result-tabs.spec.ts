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
  // Messages has no grid, so focus drops to the page until its tab takes
  // it; a second press before that is read as an editor-area press.
  await expect(resultTabs(page).first()).toBeFocused();
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

// The result tabs' statements, in strip order, after Messages.
const order = (page: Page) =>
  page
    .getByRole("tablist", { name: "Results" })
    .locator("[data-result-id]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("title")));
const centre = async (page: Page, n: number) => {
  const b = (await resultTabs(page).nth(n).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test("a kept result tab drags to a new place; others stay", async ({ page }) => {
  await connectFixture(page, db);
  await runThree(page);
  for (let n = 1; n <= 3; n++) {
    await resultTabs(page).nth(n).hover();
    await resultTabs(page).nth(n).getByRole("button", { name: "Keep result" }).click();
  }
  await expect(page.getByRole("button", { name: "Keep result", pressed: true })).toHaveCount(3);
  await resultTabs(page).nth(2).click();
  expect(await order(page)).toEqual(["select 1 as a", "select 2 as b", "select 3 as c"]);

  // The third onto the first's left quarter; the selected tab stays.
  const from = await centre(page, 3);
  const first = (await resultTabs(page).nth(1).boundingBox())!;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width / 4, from.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => order(page)).toEqual(["select 3 as c", "select 1 as a", "select 2 as b"]);
  await expect(page.getByRole("tab", { name: "select 2 as b" })).toHaveAttribute("aria-selected", "true");

  // Escape mid-drag puts it back.
  const a = await centre(page, 2);
  const b = (await resultTabs(page).nth(3).boundingBox())!;
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x + (b.width * 3) / 4, a.y, { steps: 8 });
  await expect.poll(() => order(page)).toEqual(["select 3 as c", "select 2 as b", "select 1 as a"]);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(() => order(page)).toEqual(["select 3 as c", "select 1 as a", "select 2 as b"]);

  // A tab that is not kept does not move.
  await resultTabs(page).nth(3).getByRole("button", { name: "Keep result" }).click();
  await expect(page.getByRole("button", { name: "Keep result", pressed: true })).toHaveCount(2);
  const last = await centre(page, 3);
  const front = (await resultTabs(page).nth(1).boundingBox())!;
  await page.mouse.move(last.x, last.y);
  await page.mouse.down();
  await page.mouse.move(front.x + 2, last.y, { steps: 8 });
  await page.mouse.up();
  expect(await order(page)).toEqual(["select 3 as c", "select 1 as a", "select 2 as b"]);

  // A run keeps the kept tabs in their order, then the new result.
  await runScript(page, "select 4 as d;");
  await expect.poll(() => order(page)).toEqual(["select 3 as c", "select 1 as a", "select 4 as d"]);
});
