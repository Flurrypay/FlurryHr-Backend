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
  if (path === "profile" && request.method() === "PATCH") {
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
  await page.goto(`${base}/workspace/profile`);
  await page.getByLabel("First name", { exact: true }).fill("Updated");
  await page.getByLabel("Last name", { exact: true }).fill("Person");
  await page.getByLabel("Contact phone", { exact: true }).fill("08012345678");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Updated Person", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Attendance face verification", { exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("First name", { exact: true })).toHaveValue(
    "Updated",
  );
  await expect(page.getByLabel("Contact phone", { exact: true })).toHaveValue(
    "08012345678",
  );
  role = "EMPLOYEE";
  await page.reload();
  await expect(
    page.getByText("Attendance face verification", { exact: true }),
  ).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    "Profile editing, refreshed identity, reload persistence and admin/staff enrollment visibility passed (isolated API fixtures).",
  );
} finally {
  await browser.close();
}
