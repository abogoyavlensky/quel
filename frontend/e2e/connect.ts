import { type Page, expect } from "@playwright/test";

// Connect the fixture SQLite file through a saved profile, creating the
// profile the first time: profiles last for the whole app run.
export async function connectFixture(page: Page, db: string, name = "E2E fixture") {
  await page.goto("/");
  const saved = page.getByRole("list", { name: "Saved connections" });
  const row = saved.getByRole("button", { name: new RegExp(`^${name}`) });
  // The list loads after the page: wait for it, or for the empty state.
  await expect(saved.or(page.getByText("No saved connections."))).toBeVisible();
  if ((await row.count()) === 0) {
    await page.getByRole("button", { name: "New connection" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByRole("combobox", { name: "Type" }).click();
    await page.getByRole("option", { name: "SQLite" }).click();
    await dialog.getByLabel("File").fill(db);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
  }
  await row.click();
  await expect(page.getByRole("contentinfo")).toContainText(name);
}
