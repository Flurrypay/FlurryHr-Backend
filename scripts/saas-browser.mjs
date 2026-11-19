import { chromium, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import assert from "node:assert/strict";
import { testMailToken, cleanCompanies } from "./test-support.mjs";
if (
  !/^\/flurryhr_test(?:_[a-z0-9]+)*$/i.test(
    new URL(process.env.DATABASE_URL || "postgresql://invalid/invalid")
      .pathname,
  )
)
  throw new Error("Use the isolated flurryhr_test database");
const db = new PrismaClient(),
  base = process.env.TEST_WEB_URL || "http://localhost:5175",
  suffix = Date.now().toString(),
  password = "SaaS-Browser-Password-2026!";
const organizations = [],
  extraUsers = [],
  errors = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  acceptDownloads: true,
});
const owner = await context.newPage();
owner.on("pageerror", (error) => errors.push(error.message));
const nav = (page, label) =>
  page
    .locator("aside.sidebar")
    .getByRole("button", { name: label, exact: true })
    .click();
const save = (page, label = "Save changes") =>
  page.getByRole("button", { name: label, exact: true }).click();
async function chooseOption(locator, choice) {
  await locator.click();
  const page = locator.page();
  if (typeof choice === "object")
    await page.getByRole("option", { name: choice.label, exact: true }).click();
  else
    await page
      .locator(`[role="option"][data-value=${JSON.stringify(choice)}]`)
      .click();
}
async function login(page, email) {
  await page.goto(`${base}/login`);
  await page.getByLabel("Work email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await save(page, "Sign in to workspace");
}
async function register(page, label) {
  const email = `browser-saas-${label}-${suffix}@example.test`.toLowerCase(),
    companyName = `SaaS Browser ${label} ${suffix}`;
  await page.goto(`${base}/register`);
  await page.getByLabel("Full name", { exact: true }).fill(`${label} Owner`);
  await page.getByLabel("Work email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Company name", { exact: true }).fill(companyName);
  await save(page, "Create company account");
  await expect(page).toHaveURL(/\/verify-email$/);
  const organization = await db.organization.findFirstOrThrow({
    where: { businessEmail: email },
  });
  organizations.push(organization.id);
  const token = await testMailToken(email, "Verify");
  await page.goto(`${base}/verify-email#token=${token}`);
  await save(page, "Verify email");
  await expect(page).toHaveURL(/\/company-onboarding$/);
  await page
    .getByLabel("Company address", { exact: true })
    .fill("Isolated browser test workspace");
  await save(page, "Save company & continue");
  await expect(
    page.getByRole("heading", { name: "Departments", exact: true }),
  ).toBeVisible();
  return { email, companyName, organization };
}
try {
  const safety = await owner.request.get(base + "/api/health");
  assert.equal(
    safety.headers()["x-flurryhr-test-environment"],
    "isolated-file-mail",
    "Refusing browser mutations against a non-test API or real mail transport",
  );
  await owner.goto(base);
  await expect(owner.locator(".hp-nav-register")).toHaveAttribute(
    "href",
    "/register",
  );
  const a = await register(owner, "A");
  await owner
    .getByLabel("Department name", { exact: true })
    .fill("Engineering");
  await save(owner, "Add department");
  await expect(owner.locator(".saas-simple-list")).toContainText("Engineering");
  await save(owner, "Continue with current settings");
  await expect(
    owner.getByRole("heading", { name: "Work schedules", exact: true }),
  ).toBeVisible();
  await save(owner, "Continue with current settings");
  await expect(
    owner.getByRole("heading", { name: "Leave settings", exact: true }),
  ).toBeVisible();
  await save(owner, "Continue with current settings");
  const employeeEmail = `browser-invited-${suffix}@example.test`;
  await owner.getByLabel("First name", { exact: true }).fill("Ada");
  await owner.getByLabel("Last name", { exact: true }).fill("Workflow");
  await owner.getByLabel("Employee email", { exact: true }).fill(employeeEmail);
  await owner
    .getByLabel("Job title", { exact: true })
    .fill("Software engineer");
  await chooseOption(owner.getByLabel("Department", { exact: true }), {
    label: "Engineering",
  });
  await save(owner, "Send invitation");
  await expect(
    owner
      .getByText("Invitation saved and email queued.", { exact: false })
      .first(),
  ).toBeVisible();
  await save(owner, "Continue with current settings");
  await save(owner, "Finish & open workspace");
  await expect(owner).toHaveURL(/\/workspace$/);
  await expect(
    owner.getByRole("heading", { name: /Welcome back/ }),
  ).toBeVisible();
  await nav(owner, "Invitations");
  await expect(
    owner.getByRole("cell", { name: employeeEmail, exact: true }).first(),
  ).toBeVisible();
  await expect(
    owner.getByRole("cell", { name: "Pending", exact: true }).first(),
  ).toBeVisible();
  const invitationToken = await testMailToken(employeeEmail, a.companyName);
  const employeeContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const employee = await employeeContext.newPage();
  employee.on("pageerror", (error) => errors.push(error.message));
  await employee.goto(`${base}/accept-invitation#token=${invitationToken}`);
  await employee
    .getByLabel("Set your password", { exact: true })
    .fill(password);
  await save(employee, "Accept invitation");
  await expect(
    employee.getByText("Invitation accepted.", { exact: false }).first(),
  ).toBeVisible();
  await login(employee, employeeEmail);
  await expect(employee).toHaveURL(/\/workspace$/);
  await expect(
    employee.getByRole("heading", { name: /Welcome back, Ada/ }),
  ).toBeVisible();
  await expect(
    employee
      .locator("aside.sidebar")
      .getByRole("button", { name: "Employees", exact: true }),
  ).toHaveCount(0);
  await employee.getByRole("button", { name: "Clock In", exact: true }).click();
  await expect(
    employee.getByRole("heading", { name: "You're currently clocked in" }),
  ).toBeVisible();
  await owner.reload();
  await nav(owner, "Dashboard");
  await expect(
    owner.locator(".metric-card").filter({ hasText: "At work today" }),
  ).toContainText("01");
  await employee
    .getByRole("button", { name: "Clock Out", exact: true })
    .click();
  await expect(
    employee.getByRole("heading", {
      name: "You've completed your work session",
    }),
  ).toBeVisible();
  await nav(owner, "Attendance");
  await expect(
    owner.getByRole("cell", { name: "Ada Workflow", exact: false }).first(),
  ).toBeVisible();
  const record = await db.employee.findFirstOrThrow({
    where: { organizationId: a.organization.id, email: employeeEmail },
  });
  await nav(owner, "Leave Management");
  await owner
    .getByRole("button", { name: "Allocate leave", exact: true })
    .click();
  let dialog = owner.getByRole("dialog");
  await chooseOption(dialog.getByLabel("Employee", { exact: true }), record.id);
  await dialog.getByLabel("Allocated working days", { exact: true }).fill("10");
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await nav(employee, "Leave Management");
  await employee
    .getByRole("button", { name: "Request leave", exact: true })
    .click();
  dialog = employee.getByRole("dialog");
  await dialog.getByLabel("First day", { exact: true }).fill("2026-12-07");
  await dialog.getByLabel("Last day", { exact: true }).fill("2026-12-08");
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Personal time away for the isolated workflow test");
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(employee.getByRole("dialog")).toHaveCount(0);
  await owner.reload();
  await nav(owner, "Notifications");
  await expect(
    owner.getByText("Leave request awaiting review", { exact: true }),
  ).toBeVisible();
  await nav(owner, "Leave Management");
  await owner
    .getByRole("button", { name: "Review request", exact: true })
    .click();
  dialog = owner.getByRole("dialog");
  await dialog
    .getByLabel("Review comments", { exact: true })
    .fill("Team coverage confirmed");
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await employee.reload();
  await nav(employee, "Leave Management");
  await expect(employee.getByText("Approved", { exact: true })).toBeVisible();
  await nav(owner, "Tasks & Assignments");
  await owner
    .getByRole("button", { name: "Assign a task", exact: true })
    .click();
  dialog = owner.getByRole("dialog");
  await dialog
    .getByLabel("Task title", { exact: true })
    .fill("Complete your first handover");
  await dialog
    .getByLabel("Description", { exact: true })
    .fill("Record the initial work summary");
  await chooseOption(
    dialog.getByLabel("Assign to", { exact: true }),
    record.id,
  );
  await dialog.getByLabel("Due date", { exact: true }).fill("2026-12-01");
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await employee.reload();
  await nav(employee, "Tasks & Assignments");
  await employee
    .getByRole("button", { name: "Progress & history", exact: true })
    .click();
  dialog = employee.getByRole("dialog");
  await dialog
    .getByLabel("Progress note", { exact: true })
    .fill("The handover is ready for review");
  await dialog
    .getByRole("button", { name: "Add progress note", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await chooseOption(
    employee.getByLabel("Status for Complete your first handover", {
      exact: true,
    }),
    "Completed",
  );
  await owner.reload();
  await nav(owner, "Tasks & Assignments");
  await expect(
    owner.getByLabel("Status for Complete your first handover", {
      exact: true,
    }),
  ).toHaveValue("Completed");
  await nav(owner, "Documents");
  await owner
    .getByRole("button", { name: "Upload document", exact: true })
    .click();
  dialog = owner.getByRole("dialog");
  await dialog.getByLabel("Document file", { exact: true }).setInputFiles({
    name: "Private.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Private browser test record"),
  });
  await chooseOption(
    dialog.getByLabel("Document employee owner", { exact: true }),
    record.id,
  );
  await dialog
    .getByRole("button", { name: "Upload privately", exact: true })
    .click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await expect(owner.getByText("Private.txt", { exact: true })).toBeVisible();
  await nav(employee, "Documents");
  const privateDownload = employee.waitForEvent("download");
  await employee.getByRole("button", { name: "Download", exact: true }).click();
  assert.equal((await privateDownload).suggestedFilename(), "Private.txt");
  await nav(owner, "Company Assets");
  await owner.getByRole("button", { name: "Add asset", exact: true }).click();
  dialog = owner.getByRole("dialog");
  await dialog
    .getByLabel("Asset identifier", { exact: true })
    .fill(`LAPTOP-${suffix}`);
  await dialog.getByLabel("Asset name", { exact: true }).fill("Test laptop");
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await owner.getByRole("button", { name: "Assign", exact: true }).click();
  dialog = owner.getByRole("dialog");
  await chooseOption(
    dialog.getByLabel("Assign to employee", { exact: true }),
    record.id,
  );
  await dialog
    .getByLabel("Assignment or return note", { exact: true })
    .fill("Issued for the onboarding period");
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await owner
    .getByRole("button", { name: "Record return", exact: true })
    .click();
  dialog = owner.getByRole("dialog");
  await dialog
    .getByLabel("Assignment or return note", { exact: true })
    .fill("Returned and inspected");
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await nav(owner, "Performance");
  await owner.getByRole("button", { name: "Assign goal", exact: true }).click();
  dialog = owner.getByRole("dialog");
  await chooseOption(dialog.getByLabel("Employee", { exact: true }), record.id);
  await dialog.getByLabel("Review period", { exact: true }).fill("2026 Q4");
  await dialog
    .getByLabel("Goal and success criteria", { exact: true })
    .fill("Complete the first handover with documented outcomes");
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await nav(employee, "Performance");
  await employee
    .getByRole("button", { name: "Submit assessment", exact: true })
    .click();
  dialog = employee.getByRole("dialog");
  await dialog
    .getByLabel("Assessment", { exact: true })
    .fill("I completed and documented the handover outcomes.");
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(employee.getByRole("dialog")).toHaveCount(0);
  await owner.reload();
  await nav(owner, "Performance");
  await owner
    .getByRole("button", { name: "Submit assessment", exact: true })
    .click();
  dialog = owner.getByRole("dialog");
  await dialog
    .getByLabel("Assessment", { exact: true })
    .fill("The completed handover meets the agreed criteria.");
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await expect(owner.getByText("Completed", { exact: true })).toBeVisible();
  await nav(owner, "Reports & Analytics");
  const downloadPromise = owner.waitForEvent("download");
  await owner.getByRole("button", { name: "Export CSV", exact: true }).click();
  assert.equal(
    (await downloadPromise).suggestedFilename(),
    "flurryhr-attendance.csv",
  );
  const bContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    ownerB = await bContext.newPage();
  await register(ownerB, "B");
  await ownerB
    .getByRole("button", {
      name: "Finish setup with current settings",
      exact: true,
    })
    .click();
  await expect(ownerB).toHaveURL(/\/workspace$/);
  await nav(ownerB, "Employees");
  await expect(ownerB.getByText("Ada Workflow", { exact: true })).toHaveCount(
    0,
  );
  assert.equal(
    (await ownerB.request.get(`${base}/api/employees/${record.id}`)).status(),
    404,
  );
  await nav(ownerB, "Documents");
  await expect(ownerB.getByText("Private.txt", { exact: true })).toHaveCount(0);
  await owner.goto(`${base}/workspace`);
  await expect(
    owner.getByRole("heading", { name: /Welcome back/ }),
  ).toBeVisible();
  await owner.screenshot({
    path: "/tmp/flurryhr-saas-company.png",
    fullPage: true,
    animations: "disabled",
  });
  await employee.setViewportSize({ width: 375, height: 844 });
  await employee.goto(`${base}/workspace`);
  await expect(
    employee.getByRole("button", { name: "Clock In", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      employee
        .locator(".main-shell")
        .evaluate((el) => el.getBoundingClientRect().x),
    )
    .toBe(0);
  assert.ok(
    await employee.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await employee.screenshot({
    path: "/tmp/flurryhr-saas-employee-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  const platformEmail = `browser-platform-${suffix}@example.test`;
  const platformUser = await db.user.create({
    data: {
      email: platformEmail,
      passwordHash: await hash(password, 4),
      emailVerifiedAt: new Date(),
      platformAdmin: true,
    },
  });
  extraUsers.push(platformUser.id);
  const platformContext = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
    }),
    platform = await platformContext.newPage();
  await login(platform, platformEmail);
  await expect(platform).toHaveURL(/\/platform$/);
  await expect(
    platform.getByRole("heading", { name: "Companies, connected." }),
  ).toBeVisible();
  await platform
    .getByLabel("Search companies", { exact: true })
    .fill(a.companyName);
  let row = platform.getByRole("row").filter({ hasText: a.companyName });
  await row.getByRole("button", { name: "Suspend", exact: true }).click();
  dialog = platform.getByRole("dialog");
  await dialog
    .getByLabel("Reason for this action", { exact: true })
    .fill("Isolated browser suspension policy verification");
  await dialog
    .getByLabel("Your platform administrator password", { exact: true })
    .fill(password);
  await dialog
    .getByRole("button", { name: "Confirm status change", exact: true })
    .click();
  await expect(platform.getByRole("dialog")).toHaveCount(0);
  assert.equal((await employee.request.get(`${base}/api/tasks`)).status(), 403);
  row = platform.getByRole("row").filter({ hasText: a.companyName });
  await row.getByRole("button", { name: "Reactivate", exact: true }).click();
  dialog = platform.getByRole("dialog");
  await dialog
    .getByLabel("Reason for this action", { exact: true })
    .fill("Isolated browser reactivation policy verification");
  await dialog
    .getByLabel("Your platform administrator password", { exact: true })
    .fill(password);
  await dialog
    .getByRole("button", { name: "Confirm status change", exact: true })
    .click();
  await expect(platform.getByRole("dialog")).toHaveCount(0);
  assert.equal((await employee.request.get(`${base}/api/tasks`)).status(), 200);
  await platform.screenshot({
    path: "/tmp/flurryhr-saas-platform.png",
    fullPage: true,
    animations: "disabled",
  });
  await nav(owner, "Employees");
  await owner.getByRole("button", { name: /Ada Workflow/ }).click();
  await owner
    .getByRole("button", { name: "Offboard employee", exact: true })
    .click();
  dialog = owner.getByRole("dialog");
  await dialog
    .getByLabel("Offboarding reason", { exact: true })
    .fill("Isolated browser offboarding verification");
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  assert.equal((await employee.request.get(`${base}/api/tasks`)).status(), 401);
  await nav(owner, "Offboarding");
  await expect(
    owner.getByRole("button", {
      name: "Exit: Recover assigned assets",
      exact: true,
    }),
  ).toBeVisible();
  await owner
    .getByRole("button", { name: "Exit: Recover assigned assets", exact: true })
    .click();
  await nav(owner, "Employees");
  await owner.getByRole("button", { name: /Ada Workflow/ }).click();
  await owner
    .getByRole("button", { name: "Reactivate employee", exact: true })
    .click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await login(employee, employeeEmail);
  await expect(employee).toHaveURL(/\/workspace$/);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Chrome connected SaaS journeys A–G — public registration, test-mail verification, resumable company onboarding, invitation and acceptance, employee login and clock-in/out, company monitoring, leave notification/approval, task notes/completion, private upload/report download, second-company isolation, aggregate-only platform suspension/reactivation and mobile employee layout.",
  );
} finally {
  await browser.close();
  await cleanCompanies(db, organizations, extraUsers);
  await db.$disconnect();
}
