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

const year = new Date().getFullYear();
const leaveMutations = [];
const allocation = {
  id: "allocation",
  employeeId: "staff",
  leaveTypeId: "annual",
  year,
  days: 5,
  remaining: 5,
  employee: { id: "staff", firstName: "Staff", lastName: "Member" },
  leaveType: { id: "annual", name: "Annual leave" },
};
await context.route("**/api/directory-options*", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      departments: [department],
      schedules: [schedule],
      employees: [{ id: "staff", firstName: "Staff", lastName: "Member" }],
      leaveTypes: [allocation.leaveType],
      jobs: [],
      pagination: {
        page: 1,
        limit: 100,
        totals: {
          departments: 1,
          schedules: 1,
          employees: 1,
          leaveTypes: 1,
          jobs: 0,
        },
      },
    }),
  }),
);
await context.route(/\/api\/leave/, async (route) => {
  const request = route.request(),
    path = new URL(request.url()).pathname.slice(5);
  let result;
  if (request.method() !== "GET") {
    leaveMutations.push({ path, body: request.postDataJSON() });
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ id: "request" }),
    });
  }
  if (path === "leave/allocations" || path === "leave/balances")
    result = paged([allocation]);
  else if (path === "leave-types") result = paged([allocation.leaveType]);
  else
    result = {
      requests: [],
      total: 0,
      page: 1,
      limit: 20,
      nextCursor: null,
      balances: [],
    };
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(result),
  });
});
try {
  await page.goto(`${base}/workspace`);
  await expect(
    page.getByRole("heading", { name: /Welcome back/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Clock In", exact: true }),
  ).toHaveCount(0);
  await page.goto(`${base}/workspace/leave`);
  await expect(
    page.getByRole("heading", { name: "Leave allocations", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Staff Member", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Request leave", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Allocate leave balance", exact: true })
    .click();
  await page.getByLabel("Allocated working days", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  assert.equal(leaveMutations[0].path, "leave/allocations");
  assert.equal(leaveMutations[0].body.days, 10);
  role = "EMPLOYEE";
  await page.goto(`${base}/workspace/leave`);
  await expect(
    page.getByRole("button", { name: "Request leave", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Leave allocations", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Request leave", exact: true })
    .click();
  for (const label of ["First day", "Last day"]) {
    await expect(page.getByLabel(label, { exact: true })).toHaveAttribute(
      "type",
      "date",
    );
    await expect(
      page.getByRole("button", { name: `Open ${label} calendar`, exact: true }),
    ).toBeVisible();
  }
  await page.getByLabel("First day", { exact: true }).fill(`${year}-12-07`);
  await page.getByLabel("Last day", { exact: true }).fill(`${year}-12-08`);
  await page.getByLabel("Reason", { exact: true }).fill("Personal time away");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  assert.equal(leaveMutations[1].body.startDate, `${year}-12-07`);
  assert.equal(leaveMutations[1].body.endDate, `${year}-12-08`);
  assert.deepEqual(errors, []);
  assert.deepEqual(mutations, []);
  console.log(
    "PASS: admins have no attendance/request-leave controls; allocated staff balances are visible; staff requests use native date inputs with explicit calendar buttons and ISO date submission.",
  );
} finally {
  await browser.close();
}
