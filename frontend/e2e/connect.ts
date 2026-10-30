import { type Page, expect } from "@playwright/test";

// Saved SQLite profiles for the specs. Profiles last for the whole app
// run; workspaces only as long as the page, so a fresh page starts with
// every profile disconnected.

const saved = (page: Page) => page.getByRole("list", { name: "Saved connections" });
export const profileRow = (page: Page, name: string) => saved(page).getByRole("button", { name: new RegExp(`^${name}`) });

// Make a SQLite profile for db unless one named name exists.
export async function ensureProfile(page: Page, name: string, db: string) {
  // The list loads after the page: wait for it, or for the empty state.
  await expect(saved(page).or(page.getByText("No saved connections."))).toBeVisible();
  if ((await profileRow(page, name).count()) > 0) return;
  await page.getByRole("button", { name: "New connection" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "SQLite" }).click();
  await dialog.getByLabel("File").fill(db);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
}

// Select the profile and connect it from its row: its workspace shows, ready to run.
export async function selectAndConnect(page: Page, name: string) {
  await profileRow(page, name).click();
  await saved(page).getByRole("button", { name: `Connect ${name}` }).click();
  await expect(page.getByRole("banner")).toContainText(name);
  await expect(page.getByRole("status")).toHaveText("Ready");
}

// Connect the fixture SQLite file through a saved profile, creating the
// profile the first time.
export async function connectFixture(page: Page, db: string, name = "E2E fixture") {
  await page.goto("/");
  await ensureProfile(page, name, db);
  await selectAndConnect(page, name);
}
