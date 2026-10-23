import { type Page, expect, test } from "@playwright/test";
import { ensureProfile, profileRow, selectAndConnect } from "./connect";

// A workspace per profile: two SQLite profiles (the fixture file and a
// second one with table t2, both made by scripts/e2e.sh) connected at
// once, each with its own tabs, results and sessions.

const db = process.env.QUEL_E2E_DB ?? "/tmp/quel-e2e.db";
const db2 = process.env.QUEL_E2E_DB2 ?? "/tmp/quel-e2e2.db";

const editor = (page: Page) => page.getByLabel("SQL editor");
const status = (page: Page) => page.getByRole("status");
const messages = (page: Page) => page.getByRole("log", { name: "Messages" });
const editorTabs = (page: Page) => page.getByRole("tablist", { name: "Editor tabs" }).getByRole("tab");

// Replace the active editor's text (see query-loop.spec.ts).
async function write(page: Page, sql: string) {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);
}

test("two profiles keep their own tabs, results and sessions", async ({ page }) => {
  await page.goto("/");
  await ensureProfile(page, "WS A", db);
  await ensureProfile(page, "WS B", db2);
  await selectAndConnect(page, "WS A");
  await selectAndConnect(page, "WS B");

  // A: a second tab, a temp table, and a result.
  await profileRow(page, "WS A").click();
  await expect(status(page)).toHaveText("Ready");
  await page.getByRole("button", { name: "New tab" }).click();
  await write(page, "create temp table only_a (x int); select count(*) as n from t;");
  await page.keyboard.press("ControlOrMeta+Shift+Enter");
  await expect(page.getByRole("gridcell", { name: "2000", exact: true })).toBeVisible();

  // B shows its own single, empty tab; A's temp table is not in its session.
  await profileRow(page, "WS B").click();
  await expect(editorTabs(page)).toHaveText(["Query 1"]);
  await expect(editor(page)).toHaveText("");
  await write(page, "select * from only_a;");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(messages(page)).toContainText("no such table: only_a");
  await write(page, "select count(*) as n from t2;");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("gridcell", { name: "10", exact: true })).toBeVisible();

  // Back on A: its tabs, its text and its result grid.
  await profileRow(page, "WS A").click();
  await expect(editorTabs(page)).toHaveText(["Query 1", "Query 2"]);
  await expect(editor(page)).toHaveText("create temp table only_a (x int); select count(*) as n from t;");
  await expect(page.getByRole("gridcell", { name: "2000", exact: true })).toBeVisible();

  // Disconnecting B from its row leaves A connected and B's tab in place.
  await page.getByRole("button", { name: "Disconnect WS B" }).click();
  await expect(page.getByRole("button", { name: "Connect WS B" })).toBeEnabled();
  await expect(status(page)).toHaveText("Ready");
  await profileRow(page, "WS B").click();
  await expect(status(page)).toHaveText("Not connected");
  await expect(editor(page)).toHaveText("select count(*) as n from t2;");

  // A run on B is refused with a Connect offer; Connect, and the next run works.
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(status(page)).toHaveText("Not connected.");
  await page.getByRole("contentinfo").getByRole("button", { name: "Connect" }).click();
  await expect(status(page)).toHaveText("Ready");
  await write(page, "select max(id) as m from t2;");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("tablist", { name: "Results" })).toContainText("select max(id) as m from t2");
  await expect(page.getByRole("gridcell", { name: "10", exact: true })).toBeVisible();
});
