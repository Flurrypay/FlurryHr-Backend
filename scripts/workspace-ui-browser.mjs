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
const nav = (label) =>
  page
    .locator("aside.sidebar")
    .getByRole("button", { name: label, exact: true })
    .click();
try {
  await page.goto(`${base}/workspace/settings`);
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Fixture schedule", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Fixture annual leave", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(`${base}/workspace/settings`);
  await nav("Departments");
  await expect(page).toHaveURL(`${base}/workspace/departments`);
  await nav("Settings");
  await expect(page).toHaveURL(`${base}/workspace/settings`);
  await page.goBack();
  await expect(page).toHaveURL(`${base}/workspace/departments`);
  await expect(
    page.getByRole("heading", { name: "Departments", exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(`${base}/workspace/settings`);
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  for (const [label, slug] of [
    ["Dashboard", ""],
    ["Reports & Analytics", "/reports"],
    ["Employees", "/employees"],
    ["Invitations", "/invitations"],
    ["Departments", "/departments"],
    ["Attendance", "/attendance"],
    ["Leave Management", "/leave"],
    ["Recruitment", "/recruitment"],
    ["Onboarding", "/onboarding"],
    ["Offboarding", "/offboarding"],
    ["Payroll", "/payroll"],
    ["Performance", "/performance"],
    ["Tasks & Assignments", "/tasks"],
    ["Announcements", "/announcements"],
    ["Documents", "/documents"],
    ["Company Assets", "/assets"],
    ["Notifications", "/notifications"],
    ["My Profile", "/profile"],
    ["Audit Logs", "/audit"],
    ["Company Settings", "/company-settings"],
    ["Settings", "/settings"],
  ]) {
    await nav(label);
    await expect(page).toHaveURL(`${base}/workspace${slug}`);
    await expect(page.locator(".breadcrumbs strong")).toHaveText(label);
    await page.reload();
    await expect(page.locator(".breadcrumbs strong")).toHaveText(label);
    await expect(page).toHaveURL(`${base}/workspace${slug}`);
  }
  await page
    .getByLabel("Search employees", { exact: true })
    .fill("Fixture needle");
  await page.getByLabel("Search employees", { exact: true }).press("Enter");
  await expect(page).toHaveURL(`${base}/workspace/employees`);
  await expect(
    page.getByLabel("Search directory", { exact: true }),
  ).toHaveValue("Fixture needle");
  await nav("Settings");
  await page
    .getByRole("button", { name: "Dismiss help card", exact: true })
    .click();
  await expect(page.locator(".help-card")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".help-card")).toHaveCount(0);
  membershipId = "membership-two";
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Dismiss help card", exact: true }),
  ).toBeVisible();
  legacy = true;
  await page.reload();
  await expect(
    page.getByText(/backend is running an older API version/),
  ).toBeVisible();
  assert.ok(!errors.some((message) => message.includes("totals")));
  legacy = false;
  role = "EMPLOYEE";
  await page.goto(`${base}/workspace/settings`);
  await expect(page).toHaveURL(`${base}/workspace`);
  await expect(
    page
      .locator("aside.sidebar")
      .getByRole("button", { name: "Settings", exact: true }),
  ).toHaveCount(0);
  await nav("Documents");
  await expect(page).toHaveURL(`${base}/workspace/documents`);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Documents", exact: true }),
  ).toBeVisible();
  assert.deepEqual(errors, []);
  assert.deepEqual(mutations, []);
  console.log(
    "PASS: workspace deep links, refresh, Back/Forward, role fallback, persisted per-workspace help dismissal, current settings data and clear legacy API error; isolated API fixtures, no real mutations.",
  );
} finally {
  if (errors.length) console.error("Browser errors:", errors);
  await browser.close();
}
