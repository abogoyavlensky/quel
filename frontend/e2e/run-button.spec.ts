import { type Page, expect, test } from "@playwright/test";
import { connectFixture } from "./connect";

// The Run button sits in the editor's bottom-right corner, 16px from the
// right and 12px from the bottom, measured from inside the scrollbars: when
// the editor scrolls both ways it moves up and left by their size instead
// of covering them. Headless Chromium hides scrollbars unless asked
// (Playwright passes --hide-scrollbars); without the flag it draws classic
// ones on Linux, so both have a size here.

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

const db = process.env.QUEL_E2E_DB ?? "/tmp/quel-e2e.db";

async function write(page: Page, sql: string) {
  await page.getByLabel("SQL editor").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);
}

test("the Run button stays clear of both scrollbars", async ({ page }) => {
  await connectFixture(page, db);
  const long = `select '${"x".repeat(400)}';`;
  await write(page, Array.from({ length: 80 }, () => long).join("\n"));

  const scroller = page.locator(".cm-scroller");
  const run = page.getByRole("button", { name: "Run", exact: true });
  await expect(run).toBeVisible();

  const bars = async () =>
    scroller.evaluate((el) => {
      const s = el as HTMLElement;
      return { v: s.offsetWidth - s.clientWidth, h: s.offsetHeight - s.clientHeight };
    });
  await expect.poll(async () => (await bars()).v, { message: "no vertical scrollbar: overlay scrollbars?" }).toBeGreaterThan(0);
  await expect.poll(async () => (await bars()).h, { message: "no horizontal scrollbar: overlay scrollbars?" }).toBeGreaterThan(0);
  const { v, h } = await bars();

  const box = (await scroller.boundingBox())!;
  await expect
    .poll(async () => {
      const b = (await run.boundingBox())!;
      return Math.abs(Math.round(box.x + box.width - v - 16 - (b.x + b.width)));
    })
    .toBeLessThanOrEqual(1);
  const b = (await run.boundingBox())!;
  expect(Math.abs(box.x + box.width - v - 16 - (b.x + b.width))).toBeLessThanOrEqual(1);
  expect(Math.abs(box.y + box.height - h - 12 - (b.y + b.height))).toBeLessThanOrEqual(1);
});
