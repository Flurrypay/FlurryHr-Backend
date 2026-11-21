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

let required = false,
  ownEnrollment = null,
  reviewed = false,
  reset = false;
const biometricMutations = [];
const fixtureEnrollment = () => ({
  id: "face-enrollment",
  employeeId: "other-employee",
  status: reset ? "Revoked" : reviewed ? "Approved" : "Pending",
  version: 1,
  employee: {
    firstName: "Fixture",
    lastName: "Staff",
    email: "fixture-staff@example.test",
  },
});
await context.route("**/api/biometrics/**", async (route) => {
  const req = route.request(),
    path = new URL(req.url()).pathname.slice(5);
  let result = {};
  if (req.method() !== "GET")
    biometricMutations.push({ path, body: req.postDataJSON() });
  if (path === "biometrics/mine")
    result = {
      required,
      configured: true,
      enrollment: ownEnrollment,
      consentVersion: "attendance-face-v1",
      consentNotice:
        "Fixture notice: live AWS camera check, encrypted reference storage and HR review. Withdrawal available.",
    };
  else if (path === "biometrics/policy") {
    if (req.method() === "PATCH") required = req.postDataJSON().required;
    result = { required, configured: true };
  } else if (path === "biometrics/enrollments")
    result = paged([fixtureEnrollment()]);
  else if (path === "biometrics/checks") result = paged([]);
  else if (path.endsWith("/image"))
    return route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  else if (path === "biometrics/enrollments/face-enrollment") {
    reviewed = true;
    result = { ok: true };
  } else if (path === "biometrics/employees/other-employee/reset") {
    reset = true;
    result = { ok: true };
  } else if (path === "biometrics/sessions")
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Fixture AWS service unavailable" }),
    });
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(result),
  });
});
await context.route("**/api/attendance/mine*", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      active: null,
      history: [],
      total: 0,
      page: 1,
      limit: 20,
      biometricRequired: required,
      locationPolicy: {
        configured: true,
        address: "Fixture office",
        radiusMetres: 100,
      },
    }),
  }),
);
try {
  await page.goto(`${base}/workspace/company-settings`);
  await expect(
    page.getByRole("heading", {
      name: "Attendance identity controls",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review enrollment", exact: true })
    .click();
  await expect(
    page.getByRole("img", {
      name: "Employee's submitted enrollment reference",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Review notes", { exact: true })
    .fill("Verified using trusted HR identity record");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  assert.ok(reviewed);
  await page
    .getByRole("button", { name: "Reset enrollment", exact: true })
    .click();
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Employee requested a replacement reference");
  await page
    .getByRole("button", { name: "Reset and erase reference", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  assert.ok(reset);
  await page
    .getByRole("button", { name: "Enable face requirement", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm policy change", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Disable requirement", exact: true }),
  ).toBeVisible();
  assert.equal(required, true);
  role = "EMPLOYEE";
  await page.goto(`${base}/workspace/profile`);
  await expect(
    page.getByRole("heading", {
      name: "Attendance face verification",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Enroll my face", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start live camera check", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "I understand and agree to face enrollment for attendance.",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Start live camera check", exact: true })
    .click();
  await expect(
    page.getByText("Fixture AWS service unavailable", { exact: true }),
  ).toBeVisible();
  assert.ok(
    biometricMutations.some(
      (m) => m.path === "biometrics/sessions" && m.body.consent === true,
    ),
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.goto(`${base}/workspace/attendance`);
  await page.getByRole("button", { name: "Clock In", exact: true }).click();
  await expect(page.getByText(/HR administrator to approve it/)).toBeVisible();
  assert.deepEqual(mutations, []);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("dialog")
    .screenshot({ path: "/tmp/flurryhr-face-enrollment-mobile.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: HR reference review/reset and confirmed policy controls, staff enrollment consent, AWS outage handling and required attendance gate; mocked APIs only, camera/AWS accuracy not tested.",
  );
} finally {
  await browser.close();
}
