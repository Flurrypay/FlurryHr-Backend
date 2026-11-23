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
  if (path === "company/attendance-location" && request.method() === "PATCH") {
    const data = request.postDataJSON();
    assert.equal(data.address, "Approved fixture workplace");
    assert.ok(Math.abs(data.latitude - 6.5244) < 0.00001);
    assert.ok(Math.abs(data.longitude - 3.3792) < 0.00001);
    result = { ok: true };
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
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition(success) {
          success({
            coords: { latitude: 6.5244, longitude: 3.3792, accuracy: 130 },
            timestamp: Date.now(),
          });
        },
        watchPosition() {
          return 1;
        },
        clearWatch() {},
      },
    }),
  );
  await page.goto(`${base}/workspace/company-settings`);
  const picker = page.getByRole("group", {
    name: "Company attendance location · On-site and Hybrid staff",
  });
  await picker
    .getByLabel("Approved address", { exact: true })
    .fill("Approved fixture workplace");
  await picker
    .getByRole("button", { name: "Use my current location", exact: true })
    .click();
  await expect(
    picker.getByText(/Device estimate: about 130 metres accuracy/),
  ).toBeVisible();
  await expect(picker.getByLabel("Latitude", { exact: true })).toHaveValue("");
  await expect(
    picker.getByRole("button", {
      name: "Use this approved point",
      exact: true,
    }),
  ).toBeEnabled();
  await picker
    .getByLabel("Paste coordinates (latitude, longitude)", { exact: true })
    .fill("91, 200");
  await picker
    .getByRole("button", { name: "Preview coordinates", exact: true })
    .click();
  await expect(
    picker.getByText(/Enter valid latitude, longitude coordinates/),
  ).toBeVisible();
  await picker
    .getByLabel("Paste coordinates (latitude, longitude)", { exact: true })
    .fill("6.524400, 3.379200");
  await picker
    .getByRole("button", { name: "Preview coordinates", exact: true })
    .click();
  await expect(
    picker.getByText(/Selected pin: 6.524400, 3.379200/),
  ).toBeVisible();
  await picker
    .getByRole("button", { name: "Use this approved point", exact: true })
    .click();
  await expect(picker.getByLabel("Latitude", { exact: true })).toHaveValue(
    "6.5244",
  );
  await page
    .getByRole("button", { name: "Save attendance location", exact: true })
    .click();
  await expect(page.getByText(/Attendance location saved/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await picker
    .getByRole("button", { name: "Choose on map", exact: true })
    .click();
  const map = picker.locator(".location-map");
  await expect(map).toBeVisible();
  await map.click({ position: { x: 100, y: 120 } });
  await expect(
    picker.getByRole("button", {
      name: "Use this approved point",
      exact: true,
    }),
  ).toBeEnabled();
  assert.ok((await map.boundingBox()).width <= 390);
  assert.deepEqual(errors, []);
  console.log(
    "Map setup: coarse GPS previews only, explicit confirmation, invalid coordinates, confirmed save, tile failure fallback and mobile pin selection passed.",
  );
} catch (error) {
  console.log({
    errors,
    picker: await page.locator("fieldset.work-location").innerText(),
  });
  throw error;
} finally {
  await browser.close();
}
