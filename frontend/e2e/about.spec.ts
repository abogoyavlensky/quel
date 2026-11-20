import { readFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";

// About Quel: in the desktop app it opens from Quel > About Quel…; server
// mode has no native menu, so the palette's About Quel opens it here.

const version = readFileSync(new URL("../../VERSION", import.meta.url), "utf8").trim();
const about = (page: Page) => page.getByRole("dialog", { name: "Quel" });

test("About shows the version, the links and the actions", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.keyboard.press("ControlOrMeta+Shift+P");
  await page.keyboard.type("About Quel");
  await page.keyboard.press("Enter");

  await expect(about(page)).toBeVisible();
  await expect(about(page)).toContainText(`Version ${version}`);
  await expect(about(page)).toContainText("A database client");
  await expect(about(page).getByRole("link", { name: "GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/abogoyavlensky/quel",
  );
  await expect(about(page).getByRole("link", { name: "Release notes" })).toBeVisible();
  await expect(about(page).getByRole("button", { name: "Check for Updates" })).toBeVisible();

  // Copy version info: Quel <version> (<os> <arch>).
  await about(page).getByRole("button", { name: "Copy version info" }).click();
  await expect(about(page).getByRole("button", { name: "Copied" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(new RegExp(`^Quel ${version.replace(/\./g, "\\.")} \\(\\w+ \\w+\\)$`));

  await page.keyboard.press("Escape");
  await expect(about(page)).toHaveCount(0);
});
