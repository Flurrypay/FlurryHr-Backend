import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_WEB_URL || "http://localhost:5173";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Use local frontend");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let role = "OWNER";
let departments = [
  { id: "department", name: "Administration", _count: { employees: 0 } },
];
const employee = {
  id: "fixture-employee",
  firstName: "Original",
  lastName: "Name",
  phone: "",
  departmentId: "department",
  jobTitle: "Company owner",
  employmentType: "Full-time",
  workArrangement: "Hybrid",
};
let emailNotifications = true;
await page.route("**/api/**", async (route) => {
  const request = route.request(),
    path = new URL(request.url()).pathname.slice(5);
  let result = { items: [], total: 0, page: 1, limit: 20 };
  if (path === "departments/department" && request.method() === "PATCH") {
    departments[0].name = request.postDataJSON().name;
    result = departments[0];
  } else if (
    path === "departments/department" &&
    request.method() === "DELETE"
  ) {
    departments = [];
    result = { ok: true };
  } else if (path === "departments") {
    result = {
      items: departments,
      total: departments.length,
      page: 1,
      limit: 20,
    };
  } else if (path === "performance/team") {
    result = {
      items: [
        {
          id: "review",
          employeeId: "other",
          employee: { firstName: "Test", lastName: "Staff" },
          period: "2026-11",
          goal: "Very long goal ".repeat(500),
          status: "Draft",
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    };
  } else if (path === "profile" && request.method() === "PATCH") {
    const data = request.postDataJSON();
    assert.deepEqual(Object.keys(data).sort(), [
      "emailNotifications",
      "firstName",
      "lastName",
      "phone",
    ]);
    Object.assign(employee, {
      firstName: data.firstName.trim(),
      lastName: data.lastName.trim(),
      phone: data.phone,
    });
    emailNotifications = data.emailNotifications;
    result = employee;
  } else if (request.method() !== "GET")
    throw Error(`Unexpected mutation ${path}`);
  else if (path === "auth/me")
    result = {
      id: "fixture-user",
      next: "/workspace",
      role,
      email: "fixture@example.test",
      membershipId: "membership",
      employee,
      emailNotifications,
      organization: {
        id: "company",
        name: "Fixture company",
        onboardingCompleted: true,
      },
      memberships: [],
    };
  else if (path === "directory-options")
    result = {
      departments: [{ id: "department", name: "Administration" }],
      schedules: [],
      leaveTypes: [],
      employees: [],
      jobs: [],
      pagination: {
        page: 1,
        limit: 100,
        totals: {
          departments: 1,
          schedules: 0,
          leaveTypes: 0,
          employees: 0,
          jobs: 0,
        },
      },
    };
  else if (path === "biometrics/enrollment")
    result = { enrollment: null, required: false };
  await route.fulfill({ json: result });
});
try {
  await page.goto(`${base}/workspace/departments`);
  await page
    .getByRole("button", { name: "Edit department", exact: true })
    .click();
  await page
    .getByLabel("Department name", { exact: true })
    .fill("Updated department");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Updated department", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete department", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete department", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Updated department", exact: true }),
  ).toHaveCount(0);
  await page.goto(`${base}/workspace/performance`);
  const goal = page.getByRole("region", { name: "Goal details" });
  await expect(goal).toBeVisible();
  const bounds = await goal.evaluate((el) => ({
    height: el.clientHeight,
    width: el.clientWidth,
    scroll: el.scrollHeight,
  }));
  assert.ok(
    bounds.height <= 180 &&
      bounds.width <= 350 &&
      bounds.scroll > bounds.height,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Department edit/delete and bounded scrollable performance goal browser checks passed (isolated fixtures).",
  );
} finally {
  await browser.close();
}
