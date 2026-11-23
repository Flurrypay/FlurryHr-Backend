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
let active = null;
const errors = [],
  mutations = [];
let legacy = false,
  role = "EMPLOYEE",
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
    mutations.push({ path, body: request.postDataJSON() });
    active =
      path === "attendance/clock-in"
        ? { id: "session", clockIn: new Date().toISOString() }
        : null;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(active ?? {}),
    });
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
      active,
      locationPolicy: {
        configured: true,
        address: "Fixture approved office",
        radiusMetres: 100,
      },
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
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        clearWatch() {},
        watchPosition(success) {
          if (localStorage.getItem("gps-mode") === "improving")
            setTimeout(
              () =>
                success({
                  coords: { latitude: 6.5244, longitude: 3.3792, accuracy: 5 },
                  timestamp: Date.now(),
                }),
              50,
            );
          return 1;
        },
        getCurrentPosition(success, error) {
          const mode = localStorage.getItem("gps-mode");
          if (mode === "denied") return error({ code: 1 });
          success({
            coords: {
              latitude: 6.5244,
              longitude: 3.3792,
              accuracy: ["inaccurate", "improving"].includes(mode) ? 100 : 5,
            },
            timestamp: Date.now(),
          });
        },
      },
    });
  });
  await page.goto(`${base}/workspace/attendance`);
  await expect(
    page.getByText(
      "Attendance location: Fixture approved office · 100-metre radius",
    ),
  ).toBeVisible();
  await page.evaluate(() => localStorage.setItem("gps-mode", "denied"));
  await page.getByRole("button", { name: "Clock In", exact: true }).click();
  await expect(
    page.getByText(
      "Allow location access for this site in your browser and device settings, then retry.",
    ),
  ).toBeVisible();
  assert.equal(mutations.length, 0);
  await page.evaluate(() => localStorage.setItem("gps-mode", "inaccurate"));
  await page.getByRole("button", { name: "Clock In", exact: true }).click();
  await expect(
    page.getByText(/Location accuracy is about 100 metres/),
  ).toBeVisible({ timeout: 30000 });
  assert.equal(mutations.length, 0);
  await page.evaluate(() => localStorage.setItem("gps-mode", "improving"));
  await page.getByRole("button", { name: "Clock In", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Clock Out", exact: true }),
  ).toBeVisible();
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].body.latitude, 6.5244);
  assert.equal(mutations[0].body.accuracy, 5);
  await page.getByRole("button", { name: "Clock Out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Clock In", exact: true }),
  ).toBeVisible();
  assert.equal(mutations.length, 2);
  assert.ok(mutations[1].body.capturedAt >= mutations[0].body.capturedAt);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: browser requests fresh GPS on clock-in/out; denied and inaccurate readings send no attendance mutation",
  );
} finally {
  await browser.close();
}
