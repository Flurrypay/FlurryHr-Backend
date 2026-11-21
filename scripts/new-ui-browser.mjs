import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_WEB_URL || "http://localhost:5173";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Use a local frontend; all API responses are isolated fixtures");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
});
const page = await context.newPage();
const errors = [],
  mutations = [];
let legacy = false,
  role = "OWNER",
  membershipId = "membership-one";
page.on("pageerror", (error) => errors.push(error.message));
const organization = {
  id: "fixture-company",
  name: "Fixture company",
  timezone: "Africa/Lagos",
  country: "NG",
  status: "Active",
  businessEmail: "fixture@example.test",
  address: "Fixture address",
  onboardingStep: 6,
  onboardingCompleted: true,
  emailNotifications: true,
};
const schedule = {
  id: "fixture-schedule",
  name: "Fixture schedule",
  timezone: "Africa/Lagos",
  workingDays: [1, 2, 3, 4, 5],
  startMinute: 540,
  endMinute: 1020,
  graceMinutes: 15,
  breakMinutes: 60,
};
const department = { id: "fixture-department", name: "Fixture department" };
const paged = (items) => ({
  items,
  total: items.length,
  page: 1,
  limit: 20,
  nextCursor: null,
});
await context.route("**/api/**", async (route) => {
  const request = route.request(),
    url = new URL(request.url()),
    path = url.pathname.slice(5);
  if (request.method() !== "GET") {
    mutations.push(path);
    return route.abort();
  }
  let result = paged([]);
  if (path === "auth/me")
    result = {
      id: "fixture-user",
      email: "fixture@example.test",
      role,
      next: "/workspace",
      organization,
      membershipId,
      employee: {
        id: "fixture-employee",
        firstName: "Fixture",
        lastName: "User",
        scheduleId: schedule.id,
        departmentId: department.id,
        jobTitle: "Fixture role",
      },
      memberships: ["membership-one", "membership-two"].map((id) => ({
        id,
        role,
        organization,
      })),
    };
  else if (path === "directory-options")
    result = {
      departments: [department],
      schedules: [schedule],
      leaveTypes: [],
      employees: [],
      jobs: [],
      ...(legacy
        ? {}
        : {
            pagination: {
              page: 1,
              limit: 100,
              totals: {
                departments: 1,
                schedules: 1,
                leaveTypes: 0,
                employees: 0,
                jobs: 0,
              },
            },
          }),
    };
  else if (path === "schedules") result = paged([schedule]);
  else if (path === "company") result = organization;
  else if (path === "invitations")
    result = paged([
      {
        id: "revoked-fixture",
        email: "revoked@example.test",
        role: "EMPLOYEE",
        status: "Revoked",
        expiresAt: "2026-12-01T00:00:00Z",
        delivery: { status: "Accepted", attempts: 1 },
      },
    ]);
  else if (path === "mail/configuration") result = { configured: true };
  else if (path === "leave")
    result = {
      total: 0,
      page: 1,
      limit: 20,
      nextCursor: null,
      requests: [],
      balances: [],
    };
  else if (path === "leave-types")
    result = paged([{ id: "fixture-leave", name: "Fixture annual leave" }]);
  else if (path === "dashboard")
    result = {
      timezone: "Africa/Lagos",
      metrics: {
        total: 1,
        active: 1,
        clockedIn: 0,
        onLeave: 0,
        pendingLeave: 0,
      },
      trend: [],
      departments: [],
      atWork: [],
      recentHires: [],
      announcements: [],
      tasks: [],
      activity: [],
    };
  else if (path === "attendance/mine")
    result = {
      total: 0,
      page: 1,
      limit: 20,
      nextCursor: null,
      active: null,
      history: [],
      serverTime: new Date().toISOString(),
    };
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(result),
  });
});

try {
  await page.goto(`${base}/workspace/company-settings`);
  await expect(
    page.getByLabel("Approved address", { exact: true }),
  ).toBeVisible();
  const address = await page
    .getByLabel("Approved address", { exact: true })
    .boundingBox();
  const latitude = await page
    .getByLabel("Latitude", { exact: true })
    .boundingBox();
  assert.ok(address.width > latitude.width);
  assert.ok(latitude.y > address.y);
  assert.equal(
    await page
      .locator(".work-location")
      .evaluate((e) => getComputedStyle(e).borderStyle),
    "solid",
  );
  await page.screenshot({
    path: "/tmp/flurryhr-location-desktop.png",
    fullPage: true,
  });
  await page.goto(`${base}/workspace/invitations`);
  await page
    .getByRole("button", { name: "Invite employee", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByLabel("Approved address", { exact: true }),
  ).toHaveCount(0);
  await dialog.getByLabel("Work arrangement", { exact: true }).click();
  await page.getByRole("option", { name: "Remote", exact: true }).click();
  await expect(
    dialog.getByLabel("Approved address", { exact: true }),
  ).toBeVisible();
  assert.equal(await dialog.locator(".work-location").count(), 1);
  await dialog.screenshot({ path: "/tmp/flurryhr-invite-desktop.png" });
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .screenshot({ path: "/tmp/flurryhr-delete-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("dialog")
    .screenshot({ path: "/tmp/flurryhr-delete-mobile.png" });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto(`${base}/workspace/company-settings`);
  await expect(
    page.getByLabel("Approved address", { exact: true }),
  ).toBeVisible();
  const a = await page
    .getByLabel("Approved address", { exact: true })
    .boundingBox();
  const l = await page.getByLabel("Latitude", { exact: true }).boundingBox();
  assert.ok(l.y > a.y);
  assert.ok(a.x >= 0 && a.x + a.width <= 390);
  await page.screenshot({
    path: "/tmp/flurryhr-location-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(mutations, []);
  console.log(
    "PASS: location fields use responsive stacked/grid layout; Remote-only fields and padded confirmation actions render on desktop/mobile. Screenshots saved in /tmp/flurryhr-*.png",
  );
} finally {
  await browser.close();
}
