import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_WEB_URL || "http://localhost:5173";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Use local frontend");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
let existingAccount = false,
  posts = 0;
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname.slice(5);
  if (path === "auth/me")
    return route.fulfill({
      json: { email: "fixture@example.test", next: "/workspace" },
    });
  if (path === "invitations/inspect")
    return route.fulfill({
      json: {
        email: "fixture@example.test",
        companyName: "Fixture company",
        existingAccount,
      },
    });
  if (path === "invitations/accept") {
    posts++;
    return route.fulfill({
      json: {
        message:
          "Invitation accepted. Your company account is active. Sign in to continue.",
      },
    });
  }
  return route.fulfill({ status: 404, json: { message: "Not found" } });
});
try {
  for (const existing of [false, true]) {
    existingAccount = existing;
    await page.goto("about:blank");
    await page.goto(`${base}/accept-invitation#token=fixture-token`);
    if (!existing)
      await page
        .getByLabel("Set your password", { exact: true })
        .fill("Fixture-password-2026!");
    await page
      .getByRole("button", {
        name: existing ? "Join company workspace" : "Accept invitation",
        exact: true,
      })
      .click();
    await expect(
      page.getByText(/Invitation accepted\. Your company account is active/),
    ).toHaveCount(1);
    await expect(
      page.getByRole("link", { name: "Continue to sign in", exact: true }),
    ).toHaveAttribute("href", "/login");
    await expect(
      page.getByRole("button", { name: "Accept invitation", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Join company workspace", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByLabel("Set your password", { exact: true }),
    ).toHaveCount(0);
    assert.equal(new URL(page.url()).hash, "");
  }
  assert.equal(posts, 2);
  assert.deepEqual(errors, []);
  console.log(
    "New and existing account invitation success is terminal: one message, no password/form/resubmit, sign-in link and token removed (mock API).",
  );
} finally {
  await browser.close();
}
