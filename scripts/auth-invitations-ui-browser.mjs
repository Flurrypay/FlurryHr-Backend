import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_WEB_URL || "http://localhost:5173";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Use a local frontend; API calls are isolated fixtures");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  }),
  page = await context.newPage();
let mode = "platform-error",
  loggedIn = true,
  deleted = false,
  loginPosts = 0,
  deletes = 0;
const errors = [],
  unexpected = [];
page.on("pageerror", (error) => errors.push(error.message));
const org = {
  id: "fixture-company",
  name: "Fixture company",
  status: "Active",
  timezone: "Africa/Lagos",
  onboardingCompleted: true,
};
const employee = {
  id: "fixture-employee",
  firstName: "Fixture",
  lastName: "Owner",
  scheduleId: "fixture-schedule",
  departmentId: "fixture-department",
};
const company = () => ({
  id: "fixture-owner",
  email: "fixture@example.test",
  role: "OWNER",
  platformAdmin: false,
  next: "/workspace",
  organization: org,
  membershipId: "fixture-member",
  employee,
  memberships: [{ id: "fixture-member", role: "OWNER", organization: org }],
});
const platform = () => ({
  id: "fixture-platform",
  email: "platform@example.test",
  role: "PLATFORM_ADMIN",
  platformAdmin: true,
  next: mode === "platform-login" ? "/platform-security" : "/platform",
  organization: null,
  employee: null,
  memberships: [],
});
const paged = (items) => ({
  items,
  total: items.length,
  page: 1,
  limit: 20,
  nextCursor: null,
});
await context.route("**/api/**", async (route) => {
  const req = route.request(),
    path = new URL(req.url()).pathname.slice(5),
    method = req.method();
  const respond = (data, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  if (method === "POST" && path === "auth/login") {
    loginPosts++;
    loggedIn = mode !== "cookie-lost";
    return respond(
      ["company-login", "company"].includes(mode) ? company() : platform(),
    );
  }
  if (method === "POST" && path === "auth/logout") {
    loggedIn = false;
    return respond({ ok: true });
  }
  if (method === "DELETE" && path === "invitations/revoked-fixture") {
    deletes++;
    deleted = true;
    return respond({ ok: true });
  }
  if (method !== "GET") {
    unexpected.push(`${method} ${path}`);
    return route.abort();
  }
  if (path === "auth/me") {
    if (mode === "platform-error")
      return respond({ message: "Fixture service unavailable" }, 503);
    if (!loggedIn) return respond({ message: "Please sign in" }, 401);
    return respond(
      ["platform", "platform-login"].includes(mode) ? platform() : company(),
    );
  }
  if (path === "auth/mfa/status")
    return respond({ enrolled: false, recoveryCodesRemaining: 0 });
  if (path === "platform/overview")
    return respond({
      metrics: {
        total: 0,
        active: 0,
        pending: 0,
        suspended: 0,
        users: 1,
        invitations: 0,
        accepted: 0,
        mailFailures: 0,
      },
      health: {
        database: "Connected",
        emailConfigured: true,
        transport: "Fixture",
      },
      activity: [],
      registrations: [],
      usage: [],
    });
  if (path === "invitations")
    return respond(
      paged([
        ...(!deleted
          ? [
              {
                id: "revoked-fixture",
                email: "revoked@example.test",
                role: "EMPLOYEE",
                status: "Revoked",
                expiresAt: "2026-12-01",
                delivery: null,
              },
            ]
          : []),
        {
          id: "pending-fixture",
          email: "pending@example.test",
          role: "EMPLOYEE",
          status: "Pending",
          expiresAt: "2026-12-01",
          delivery: null,
        },
      ]),
    );
  if (path === "directory-options")
    return respond({
      departments: [],
      schedules: [],
      leaveTypes: [],
      employees: [],
      jobs: [],
      pagination: {
        page: 1,
        limit: 100,
        totals: {
          departments: 0,
          schedules: 0,
          leaveTypes: 0,
          employees: 0,
          jobs: 0,
        },
      },
    });
  if (path === "mail/configuration") return respond({ configured: true });
  if (path === "attendance/mine")
    return respond({ total: 0, page: 1, limit: 20, history: [], active: null });
  if (path === "dashboard")
    return respond({
      metrics: {
        total: 1,
        active: 1,
        clockedIn: 0,
        onLeave: 0,
        pendingLeave: 0,
      },
      timezone: "Africa/Lagos",
      trend: [],
      departments: [],
      atWork: [],
      recentHires: [],
      announcements: [],
      tasks: [],
      activity: [],
    });
  return respond(paged([]));
});
async function fillLogin() {
  await expect(
    page.getByRole("button", {
      name: /^Sign in to (workspace|platform)$/,
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Work email", { exact: true })
    .fill("fixture@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Isolated-fixture-password!");
  await page
    .getByRole("button", {
      name: /^Sign in to (workspace|platform)$/,
      exact: true,
    })
    .click();
}
try {
  await page.goto(`${base}/platform`);
  await expect(
    page.getByText("Fixture service unavailable", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(`${base}/platform`);
  mode = "platform";
  await page
    .getByRole("button", { name: "Retry access check", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Companies, connected.", exact: true }),
  ).toBeVisible();
  mode = "company";
  await page.reload();
  await expect(page.getByText(/This is a company account/)).toBeVisible();
  await expect(page).toHaveURL(`${base}/platform`);
  await page
    .getByRole("link", { name: "Sign in with another account", exact: true })
    .click();
  await expect(page).toHaveURL(`${base}/platform/login`);
  await expect(
    page.getByRole("heading", {
      name: "Platform administrator sign in",
      exact: true,
    }),
  ).toBeVisible();
  await fillLogin();
  await expect(
    page.getByText(/does not have platform administrator access/),
  ).toBeVisible();
  await expect(page).toHaveURL(`${base}/platform/login`);
  loginPosts = 0;
  mode = "cookie-lost";
  loggedIn = false;
  await page.goto(`${base}/login`);
  await fillLogin();
  await expect(
    page.getByText(/sign-in session could not be confirmed/),
  ).toBeVisible();
  await expect(page).toHaveURL(`${base}/login`);
  assert.equal(loginPosts, 1);
  mode = "platform-login";
  loggedIn = false;
  await page.goto(`${base}/platform/login`);
  await fillLogin();
  await expect(page).toHaveURL(`${base}/platform-security`);
  await expect(
    page.getByRole("heading", {
      name: "Protect your platform account",
      exact: true,
    }),
  ).toBeVisible();
  mode = "company-login";
  loggedIn = false;
  await page.goto(`${base}/login`);
  await fillLogin();
  await expect(page).toHaveURL(`${base}/workspace`);
  await expect(page.locator(".breadcrumbs strong")).toHaveText("Dashboard");
  mode = "invitations";
  await page.goto(`${base}/workspace/invitations`);
  const revoked = page
    .locator("tr")
    .filter({ hasText: "revoked@example.test" });
  await expect(
    revoked.getByRole("button", { name: "Delete", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator("tr")
      .filter({ hasText: "pending@example.test" })
      .getByRole("button", { name: "Delete", exact: true }),
  ).toHaveCount(0);
  await revoked.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Audit and sending history are retained",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  assert.equal(deletes, 0);
  await revoked.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete invitation", exact: true })
    .click();
  await expect(revoked).toHaveCount(0);
  await expect(
    page.locator("tr").filter({ hasText: "pending@example.test" }),
  ).toHaveCount(1);
  assert.equal(deletes, 1);
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log(
    "PASS: visible retryable platform failures, dedicated-account messaging, cookie-loss login without redirect loop, platform MFA and company routing, revoked-only delete confirmation/cancel/success; isolated fixtures only.",
  );
} finally {
  if (errors.length) console.error(errors);
  await browser.close();
}
