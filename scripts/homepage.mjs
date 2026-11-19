import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
const base = process.env.TEST_WEB_URL || "http://localhost:5173";
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
});
const page = await context.newPage();
const errors = [],
  apiCalls = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (request) => {
  if (new URL(request.url()).pathname.startsWith("/api/"))
    apiCalls.push(request.url());
});
try {
  await page.goto(base);
  await expect(page).toHaveTitle(
    "FlurryPay HR | Employee & Workforce Management",
  );
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Everything your",
  );
  assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
  for (const [name, hash] of [
    ["Features", "#features"],
    ["How It Works", "#how-it-works"],
    ["Platform", "#platform"],
    ["Home", "#home"],
  ]) {
    await page
      .getByRole("navigation", { name: "Homepage navigation" })
      .getByRole("link", { name, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(hash + "$"));
  }
  const demo = page.locator(".hp-attendance-preview");
  await demo.getByRole("button", { name: "Clock In", exact: true }).click();
  await expect(demo.getByRole("heading")).toHaveText(
    "You're currently clocked in",
  );
  await demo.getByRole("button", { name: "Clock Out", exact: true }).click();
  await expect(demo.getByRole("heading")).toHaveText(
    "You've completed your work session",
  );
  await demo.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(demo.getByRole("heading")).toHaveText(
    "You haven't clocked in today",
  );
  assert.deepEqual(
    apiCalls,
    [],
    "Public homepage and demo must not request private data or attendance APIs",
  );
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(base);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `No page overflow at ${width}px`,
    );
    if (width === 375) {
      await page
        .getByRole("button", { name: "Open menu", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Close menu", exact: true }),
      ).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Open menu", exact: true }),
      ).toHaveAttribute("aria-expanded", "false");
      await page
        .getByRole("button", { name: "Open menu", exact: true })
        .click();
      await page
        .getByRole("navigation", { name: "Homepage navigation" })
        .getByRole("link", { name: "Features", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Open menu", exact: true }),
      ).toHaveAttribute("aria-expanded", "false");
      await page.goto(base);
    }
    if (width === 375 || width === 1440)
      await page.screenshot({
        path: `/tmp/flurryhr-home-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
  }
  await context.grantPermissions([]);
  const links = await page
    .locator(".home-page a")
    .evaluateAll((elements) => elements.map((el) => el.getAttribute("href")));
  assert.ok(
    links.every(
      (h) =>
        h === "/" || h === "/login" || h === "/register" || h.startsWith("#"),
    ),
    "All homepage links must have valid destinations",
  );
  assert.equal(await page.locator('a[href*="signup"]').count(), 0);
  await page
    .getByRole("link", { name: "Sign In to Workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Good to see you again" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto(`${base}/workspace`);
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Good to see you again" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "FlurryPay HR home" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Everything your",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(base);
  assert.equal(
    await page
      .locator(".hp-hero-copy")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: homepage sections/navigation, isolated interactive attendance, no public API calls, sign-in integration, protected workspace redirect, mobile menu, reduced motion, and responsive widths 375/768/1024/1440. Screenshots: /tmp/flurryhr-home-375.png and /tmp/flurryhr-home-1440.png",
  );
} finally {
  await browser.close();
}
