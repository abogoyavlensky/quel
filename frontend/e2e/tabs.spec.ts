import { type Page, expect, test } from "@playwright/test";
import { ensureProfile, profileRow } from "./connect";

// Editor tabs are saved per profile: their names, pins and text come back
// on a reload, which stands in for an app restart (server mode keeps the
// backend, and the page rebuilds its state from the app database). Closed
// tabs can be reopened from the history menu.

const db = process.env.QUEL_E2E_DB ?? "/tmp/quel-e2e.db";

const editor = (page: Page) => page.getByLabel("SQL editor");
const editorTabs = (page: Page) => page.getByRole("tablist", { name: "Editor tabs" }).getByRole("tab");
const tab = (page: Page, name: string) => editorTabs(page).filter({ hasText: name });

async function write(page: Page, sql: string) {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);
}

// Saves are debounced: let the last one land before reloading.
const settle = (page: Page) => page.waitForTimeout(1500);

test("tabs keep their names, pins and text across a reload, and closed ones reopen", async ({ page }) => {
  // A profile of its own, so a retry starts from no saved tabs.
  const name = `Tabs ${Date.now()}`;
  await page.goto("/");
  await ensureProfile(page, name, db);
  await profileRow(page, name).click();
  await expect(editorTabs(page)).toHaveText(["Query 1"]);

  await write(page, "select count(*) from t;");
  await page.getByRole("button", { name: "New tab" }).click();
  await write(page, "select name from t where id = 7;");

  // Rename Query 1 from its menu: the name field takes the typing.
  await tab(page, "Query 1").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await expect(page.getByRole("textbox", { name: "Tab name" })).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Counts");
  await page.keyboard.press("Enter");

  // Pin Query 2: it moves first.
  await tab(page, "Query 2").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Pin" }).click();
  await expect(editorTabs(page)).toHaveText(["Query 2", "Counts"]);

  await settle(page);
  await page.reload();
  await profileRow(page, name).click();
  await expect(editorTabs(page)).toHaveText(["Query 2", "Counts"]);
  await expect(page.getByRole("button", { name: "Unpin Query 2" })).toBeVisible();
  await tab(page, "Query 2").click();
  await expect(editor(page)).toHaveText("select name from t where id = 7;");
  await tab(page, "Counts").click();
  await expect(editor(page)).toHaveText("select count(*) from t;");

  // A pinned tab is not closed (the middle click takes the path Cmd+W does).
  await tab(page, "Query 2").click({ button: "middle" });
  await expect(editorTabs(page)).toHaveText(["Query 2", "Counts"]);
  await expect(page.getByRole("status")).toHaveText("Unpin the tab to close it.");

  // Close the other, and reopen it from the history menu, text and all.
  await page.getByRole("button", { name: "Close Counts" }).click();
  await expect(editorTabs(page)).toHaveText(["Query 2"]);
  await page.getByRole("button", { name: "Recently closed tabs" }).click();
  await page.getByRole("menuitem", { name: /Counts/ }).click();
  await expect(editorTabs(page)).toHaveText(["Query 2", "Counts"]);
  await expect(editor(page)).toHaveText("select count(*) from t;");

  // And the reopened tab is saved too.
  await settle(page);
  await page.reload();
  await profileRow(page, name).click();
  await expect(editorTabs(page)).toHaveText(["Query 2", "Counts"]);
  await page.getByRole("button", { name: "Recently closed tabs" }).click();
  await expect(page.getByRole("menuitem", { name: "No closed tabs" })).toBeVisible();
});
