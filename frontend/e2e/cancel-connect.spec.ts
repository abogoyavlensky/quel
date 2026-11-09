import net from "node:net";
import { type Page, expect, test } from "@playwright/test";
import { expectNotConnected, profileRow } from "./connect";

// A connect or Test that hangs (a server that takes the connection and
// never answers) can be cancelled, and the row goes back to not connected
// with no error. No Postgres needed: a local socket stands in for the
// stuck server.

const db = process.env.QUEL_E2E_DB ?? "/tmp/quel-e2e.db";
const dialog = (page: Page) => page.getByRole("dialog");
const saved = (page: Page) => page.getByRole("list", { name: "Saved connections" });
const name = "E2E silent";

let server: net.Server;
let port = 0;
const sockets: net.Socket[] = [];

test.beforeAll(async () => {
  server = net.createServer((s) => {
    sockets.push(s);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as net.AddressInfo).port;
});

test.afterAll(async () => {
  for (const s of sockets) s.destroy();
  await new Promise((resolve) => server.close(resolve));
});

async function fillSilent(page: Page) {
  await dialog(page).getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "PostgreSQL" }).click();
  await dialog(page).getByLabel("Host").fill("127.0.0.1");
  await dialog(page).getByLabel("Port").fill(String(port));
  await dialog(page).getByLabel("Database").fill("x");
  await dialog(page).getByLabel("User").fill("x");
}

// The silent profile, saved once for the run (the port is this run's).
async function ensureSilent(page: Page) {
  await page.goto("/");
  await expect(saved(page).or(page.getByText("No saved connections."))).toBeVisible();
  if ((await profileRow(page, name).count()) > 0) return;
  await page.getByRole("button", { name: "New connection" }).first().click();
  await dialog(page).getByLabel("Name").fill(name);
  await fillSilent(page);
  await dialog(page).getByRole("button", { name: "Save" }).click();
  await expect(dialog(page)).toHaveCount(0);
}

test("a stuck connect is cancelled from its row", async ({ page }) => {
  await ensureSilent(page);
  await profileRow(page, name).click();
  await saved(page).getByRole("button", { name: `Connect ${name}` }).click();
  const cancel = saved(page).getByRole("button", { name: `Cancel connecting ${name}` });
  await expect(cancel).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("Connecting…");
  await cancel.click();
  await expectNotConnected(page);
  await expect(saved(page).getByRole("button", { name: `Connect ${name}` })).toBeEnabled({ timeout: 2000 });
  await expect(saved(page).getByRole("alert")).toHaveCount(0);
});

test("a stuck connect is cancelled from the empty tab", async ({ page }) => {
  await ensureSilent(page);
  await profileRow(page, name).click();
  await saved(page).getByRole("button", { name: `Connect ${name}` }).click();
  await page.getByRole("button", { name: `Cancel connecting to ${name}` }).click();
  await expectNotConnected(page);
  await expect(page.getByRole("button", { name: `Connect to ${name}` })).toBeVisible();
  await expect(saved(page).getByRole("alert")).toHaveCount(0);
});

test("a stuck Test is cancelled, and the next one shows only its own result", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New connection" }).first().click();
  await dialog(page).getByLabel("Name").fill("E2E test cancel");
  await fillSilent(page);
  await dialog(page).getByRole("button", { name: "Test" }).click();
  await dialog(page).getByRole("button", { name: "Cancel test" }).click();
  await expect(dialog(page).getByRole("button", { name: "Test" })).toBeEnabled();
  await expect(dialog(page).getByRole("alert")).toHaveCount(0);
  await expect(dialog(page)).not.toContainText("Connected");

  // Another Test right after, on a file that opens: only its result shows.
  await dialog(page).getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "SQLite" }).click();
  await dialog(page).getByLabel("File").fill(db);
  await dialog(page).getByRole("button", { name: "Test" }).click();
  await expect(dialog(page)).toContainText("Connected");
  await page.waitForTimeout(1000);
  await expect(dialog(page)).toContainText("Connected");
  await expect(dialog(page).getByRole("alert")).toHaveCount(0);
});

test("closing the dialog stops a Test", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New connection" }).first().click();
  await dialog(page).getByLabel("Name").fill("E2E test close");
  await fillSilent(page);
  await dialog(page).getByRole("button", { name: "Test" }).click();
  await expect(dialog(page).getByRole("button", { name: "Cancel test" })).toBeVisible();
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await page.getByRole("button", { name: "New connection" }).first().click();
  await expect(dialog(page).getByRole("button", { name: "Test" })).toBeVisible();
  await expect(dialog(page).getByRole("alert")).toHaveCount(0);
  await expect(dialog(page)).not.toContainText("Connected");
});
