import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const { totp } = createRequire(import.meta.url)("../dist/src/totp.js");
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
function responseFor(page, predicate) {
  const pending = page.waitForResponse(predicate);
  void pending.catch(() => {}); // Preserve the original action failure while finally cleans fixtures.
  return pending;
}
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
  const directorySchedule = await db.schedule.findFirstOrThrow({
    where: { organizationId: a.organization.id },
  });
  const directoryDepartment = await db.department.findFirstOrThrow({
    where: { organizationId: a.organization.id },
  });
  const paginationDomain = `@${suffix}.pagination.example.test`;
  await db.employee.createMany({
    data: Array.from({ length: 125 }, (_, i) => ({
      organizationId: a.organization.id,
      firstName: `Zzz page ${i}`,
      lastName: "Fixture",
      email: `employee-${i}${paginationDomain}`,
      jobTitle: "Pagination fixture",
      joinedAt: new Date("2026-01-01"),
      departmentId: directoryDepartment.id,
      scheduleId: directorySchedule.id,
    })),
  });
  const dummyEmployees = await db.employee.findMany({
    where: {
      organizationId: a.organization.id,
      email: { endsWith: paginationDomain },
    },
    orderBy: [{ firstName: "asc" }, { id: "asc" }],
  });
  const farManager = dummyEmployees.at(-1),
    editFixture = dummyEmployees[0];
  await db.employee.update({
    where: { id: editFixture.id },
    data: { managerId: farManager.id },
  });
  const lookupPages = [];
  const recordLookupPage = (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/directory-options"))
      lookupPages.push(Number(url.searchParams.get("page")));
  };
  owner.on("request", recordLookupPage);
  await owner.reload();
  await expect(
    owner.getByRole("heading", { name: /Welcome back/ }),
  ).toBeVisible();
  await nav(owner, "Employees");
  await expect(owner.locator("tbody tr")).toHaveCount(10);
  const firstDirectoryRows = await owner.locator("tbody tr").allTextContents();
  const nextDirectoryResponse = responseFor(owner, (response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith("/employees") &&
      url.searchParams.get("page") === "2"
    );
  });
  await owner.getByRole("button", { name: "Next page", exact: true }).click();
  assert.ok(
    new URL((await nextDirectoryResponse).url()).searchParams.get("after"),
  );
  await expect
    .poll(() => owner.locator("tbody tr").allTextContents())
    .not.toEqual(firstDirectoryRows);
  await expect(owner.locator("tbody tr")).toHaveCount(10);
  assert.equal(
    (await owner.locator("tbody tr").allTextContents()).filter((row) =>
      firstDirectoryRows.includes(row),
    ).length,
    0,
  );
  await owner
    .getByRole("button", { name: "Previous page", exact: true })
    .click();
  await expect
    .poll(() => owner.locator("tbody tr").allTextContents())
    .toEqual(firstDirectoryRows);
  await expect.poll(() => lookupPages.length).toBeGreaterThan(0);
  assert.ok(
    lookupPages.every((page) => page === 1),
    "Workspace startup must not traverse the employee roster",
  );
  owner.off("request", recordLookupPage);
  await owner
    .getByLabel("Search directory", { exact: true })
    .fill(editFixture.email);
  await expect(owner.locator("tbody tr")).toHaveCount(1);
  await owner.locator(".table-person").click();
  await owner
    .getByRole("dialog")
    .getByRole("button", { name: "Edit employee", exact: true })
    .click();
  const editDialog = owner.getByRole("dialog");
  await expect(
    editDialog.getByLabel("Reporting manager", { exact: true }),
  ).toHaveText(`${farManager.firstName} ${farManager.lastName}`);
  await expect(editDialog.locator('select[name="managerId"]')).toHaveValue(
    farManager.id,
  );
  await editDialog
    .getByLabel("Job title", { exact: true })
    .fill("Edited pagination fixture");
  await editDialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  assert.equal(
    (await db.employee.findUniqueOrThrow({ where: { id: editFixture.id } }))
      .managerId,
    farManager.id,
  );
  await owner.getByLabel("Search directory", { exact: true }).fill("");

  await nav(owner, "Attendance");
  const summaryPanel = owner
    .locator(".panel")
    .filter({
      has: owner.getByRole("heading", {
        name: "Daily attendance summary",
        exact: true,
      }),
    })
    .last();
  await expect(summaryPanel.locator("tbody tr")).toHaveCount(20);
  const firstSummaryRows = await summaryPanel
    .locator("tbody tr")
    .allTextContents();
  const summaryResponse = responseFor(owner, (response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith("/attendance/summary") &&
      url.searchParams.get("page") === "2"
    );
  });
  await owner
    .getByRole("button", { name: "Next summary page", exact: true })
    .click();
  assert.ok(new URL((await summaryResponse).url()).searchParams.get("after"));
  await expect
    .poll(() => summaryPanel.locator("tbody tr").allTextContents())
    .not.toEqual(firstSummaryRows);
  await expect(summaryPanel.locator("tbody tr")).toHaveCount(20);

  await db.employee.updateMany({
    where: {
      organizationId: a.organization.id,
      email: { endsWith: paginationDomain },
    },
    data: { managerId: null },
  });
  await db.employee.deleteMany({
    where: {
      organizationId: a.organization.id,
      email: { endsWith: paginationDomain },
    },
  });
  await db.department.createMany({
    data: Array.from({ length: 125 }, (_, i) => ({
      organizationId: a.organization.id,
      name: `Lookup department ${String(i).padStart(3, "0")}`,
    })),
  });
  await owner.reload();
  await expect(
    owner.getByRole("heading", { name: /Welcome back/ }),
  ).toBeVisible();
  await nav(owner, "Departments");
  await owner
    .getByLabel("Search departments", { exact: true })
    .fill("Lookup department");
  await expect(owner.locator(".pagination").last()).toContainText(
    "125 records",
  );
  await expect(owner.locator(".department-card h2")).toHaveCount(20);
  const firstDepartmentRows = await owner
    .locator(".department-card h2")
    .allTextContents();
  const nextDepartment = responseFor(owner, (response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith("/departments") &&
      url.searchParams.get("page") === "2"
    );
  });
  await owner.getByRole("button", { name: "Next page", exact: true }).click();
  assert.ok(new URL((await nextDepartment).url()).searchParams.get("after"));
  await expect
    .poll(() => owner.locator(".department-card h2").allTextContents())
    .not.toEqual(firstDepartmentRows);
  await expect(owner.locator(".department-card h2")).toHaveCount(20);
  assert.equal(
    (await owner.locator(".department-card h2").allTextContents()).filter(
      (name) => firstDepartmentRows.includes(name),
    ).length,
    0,
  );
  await nav(owner, "Employees");
  await owner
    .getByRole("button", { name: "Add employee", exact: true })
    .click();
  await owner
    .getByRole("dialog")
    .getByLabel("Department", { exact: true })
    .click();
  await owner
    .getByRole("searchbox", { name: "Search Department", exact: true })
    .fill("Lookup department 124");
  await owner
    .getByRole("option", { name: "Lookup department 124", exact: true })
    .click();
  await expect(
    owner.getByRole("dialog").getByLabel("Department", { exact: true }),
  ).toHaveText("Lookup department 124");
  const lookupDepartment = await db.department.findFirstOrThrow({
    where: { organizationId: a.organization.id, name: "Lookup department 124" },
  });
  await expect(
    owner.getByRole("dialog").locator('select[name="departmentId"]'),
  ).toHaveValue(lookupDepartment.id);
  await owner
    .getByRole("dialog")
    .getByLabel("Department", { exact: true })
    .click();
  await expect(
    owner.getByRole("searchbox", { name: "Search Department", exact: true }),
  ).toHaveValue("");
  const nextLookup = responseFor(owner, (response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith("/directory-options/departments") &&
      url.searchParams.get("page") === "2"
    );
  });
  await owner
    .getByRole("button", { name: "Load more options", exact: true })
    .click();
  assert.ok(new URL((await nextLookup).url()).searchParams.get("after"));
  await expect(
    owner.getByRole("option", { name: "Lookup department 075", exact: true }),
  ).toBeVisible();
  await owner
    .getByRole("searchbox", { name: "Search Department", exact: true })
    .press("Escape");
  await expect(owner.getByRole("dialog")).toBeVisible();
  await expect(owner.getByRole("listbox")).toHaveCount(0);
  await owner
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  const pagedJob = await db.job.create({
    data: {
      organizationId: a.organization.id,
      title: "Paged browser position",
      department: "Engineering",
      description: "Nested pagination fixture",
    },
  });
  await db.candidate.createMany({
    data: Array.from({ length: 125 }, (_, i) => ({
      organizationId: a.organization.id,
      jobId: pagedJob.id,
      name: `Browser candidate ${String(i).padStart(3, "0")}`,
      email: `browser-candidate-${i}@example.test`,
    })),
  });
  await db.job.createMany({
    data: Array.from({ length: 21 }, (_, i) => ({
      organizationId: a.organization.id,
      title: `Bulk browser position ${i}`,
      department: "Engineering",
      description: "Isolated parent-page fixture",
      createdAt: new Date("2026-01-01"),
    })),
  });
  const candidateFetches = [];
  const trackCandidates = (request) => {
    if (/\/jobs\/[^/]+\/candidates$/.test(new URL(request.url()).pathname))
      candidateFetches.push(request.url());
  };
  owner.on("request", trackCandidates);
  await nav(owner, "Recruitment");
  await expect(owner.getByText(/125 candidates/)).toBeVisible();
  assert.equal(
    candidateFetches.length,
    0,
    "Closed candidate lists must not issue per-job requests",
  );
  await owner.getByText("View candidates", { exact: true }).click();
  await expect(owner.locator("tbody tr")).toHaveCount(20);
  await owner
    .getByRole("button", { name: "Next page", exact: true })
    .first()
    .click();
  await expect(owner.getByText("Page 2 of 7", { exact: false })).toBeVisible();
  await owner
    .getByLabel("Search candidates", { exact: true })
    .fill("Browser candidate 124");
  await expect(owner.locator("tbody tr")).toHaveCount(1);
  await expect(
    owner.getByRole("cell", { name: /Browser candidate 124/ }),
  ).toBeVisible();
  owner.off("request", trackCandidates);
  await owner
    .getByRole("button", { name: "Add candidate", exact: true })
    .click();
  const candidateDialog = owner.getByRole("dialog");
  await candidateDialog
    .getByLabel("Full name", { exact: true })
    .fill("Remote position candidate");
  await candidateDialog
    .getByLabel("Email", { exact: true })
    .fill(`remote-candidate-${suffix}@example.test`);
  await expect(candidateDialog.locator('select[name="jobId"]')).toHaveValue("");
  await candidateDialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(candidateDialog).toBeVisible();
  assert.equal(
    await db.candidate.count({
      where: {
        organizationId: a.organization.id,
        email: `remote-candidate-${suffix}@example.test`,
      },
    }),
    0,
  );
  await expect(
    owner.getByRole("searchbox", { name: "Search Position", exact: true }),
  ).toBeVisible();
  await owner
    .getByRole("option", { name: "Paged browser position", exact: true })
    .click();
  await candidateDialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  assert.equal(
    await db.candidate.count({
      where: {
        organizationId: a.organization.id,
        jobId: pagedJob.id,
        email: `remote-candidate-${suffix}@example.test`,
      },
    }),
    1,
  );
  await expect(
    owner.getByRole("heading", { name: "Paged browser position", exact: true }),
  ).toBeVisible();
  const rootJobNext = responseFor(owner, (response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith("/recruitment") &&
      url.searchParams.get("page") === "2"
    );
  });
  await owner
    .locator(".pagination")
    .last()
    .getByRole("button", { name: "Next page", exact: true })
    .click();
  assert.ok(new URL((await rootJobNext).url()).searchParams.get("after"));
  await expect(
    owner.getByRole("heading", { name: /Bulk browser position/ }),
  ).toHaveCount(2);
  await owner
    .locator(".pagination")
    .last()
    .getByRole("button", { name: "Previous page", exact: true })
    .click();
  await expect(
    owner.getByRole("heading", { name: "Paged browser position", exact: true }),
  ).toBeVisible();
  await nav(owner, "Invitations");
  await expect(
    owner.getByRole("cell", { name: employeeEmail, exact: true }).first(),
  ).toBeVisible();
  await expect(
    owner.getByRole("cell", { name: "Awaiting response", exact: true }).first(),
  ).toBeVisible();
  const historyInvitation = await db.invitation.findFirstOrThrow({
    where: { organizationId: a.organization.id, email: employeeEmail },
  });
  await db.mailJob.createMany({
    data: Array.from({ length: 125 }, () => ({
      organizationId: a.organization.id,
      referenceId: historyInvitation.id,
      to: employeeEmail,
      subject: "Isolated sending-history fixture",
      body: "[Isolated fixture]",
      status: "Accepted",
      createdAt: new Date("2026-01-01"),
    })),
  });
  await owner.locator("summary").filter({ hasText: "Sending history" }).click();
  const sendingHistory = owner.locator("details").filter({
    has: owner.locator("summary").filter({ hasText: "Sending history" }),
  });
  await expect(sendingHistory.locator("li")).toHaveCount(5);
  await sendingHistory
    .getByRole("button", { name: "Next page", exact: true })
    .click();
  await expect(
    sendingHistory.getByText("Page 2 of 26", { exact: false }),
  ).toBeVisible();
  await sendingHistory.locator("summary").click();
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
  await expect(
    employee.getByRole("table").getByText("Approved", { exact: true }),
  ).toBeVisible();
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
  const historyTask = await db.task.findFirstOrThrow({
    where: {
      organizationId: a.organization.id,
      title: "Complete your first handover",
    },
  });
  await db.taskEvent.createMany({
    data: Array.from({ length: 125 }, (_, i) => ({
      organizationId: a.organization.id,
      taskId: historyTask.id,
      actorId: "isolated-browser",
      status: "To Do",
      note: `History fixture ${i}`,
    })),
  });
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
  await expect(dialog.locator(".saas-simple-list li")).toHaveCount(20);
  await dialog.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(dialog.getByText("Page 2 of 7", { exact: false })).toBeVisible();
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
  ).toHaveText("Completed");
  await owner
    .getByLabel("Search tasks", { exact: true })
    .fill("No matching handover");
  await expect(owner.getByText("Room to focus", { exact: true })).toBeVisible();
  await owner.getByLabel("Search tasks", { exact: true }).fill("");
  await chooseOption(
    owner.getByLabel("Filter tasks status", { exact: true }),
    "To Do",
  );
  await expect(owner.getByText("Room to focus", { exact: true })).toBeVisible();
  await chooseOption(
    owner.getByLabel("Filter tasks status", { exact: true }),
    "Completed",
  );
  await expect(
    owner.getByLabel("Status for Complete your first handover", {
      exact: true,
    }),
  ).toHaveText("Completed");
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
  const historyAsset = await db.asset.findFirstOrThrow({
    where: {
      organizationId: a.organization.id,
      identifier: `LAPTOP-${suffix}`,
    },
  });
  await db.assetHistory.createMany({
    data: Array.from({ length: 125 }, (_, i) => ({
      organizationId: a.organization.id,
      assetId: historyAsset.id,
      actorId: "isolated-browser",
      action: "Inspected",
      reason: `History fixture ${i}`,
    })),
  });
  await owner.getByRole("button", { name: "History", exact: true }).click();
  dialog = owner.getByRole("dialog");
  await expect(dialog.locator(".saas-simple-list li")).toHaveCount(20);
  await dialog.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(dialog.getByText("Page 2 of 7", { exact: false })).toBeVisible();
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
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
  await expect(
    owner.getByRole("table").getByText("Completed", { exact: true }),
  ).toBeVisible();
  const collectionPrefix = `Paged collection ${suffix}`;
  const listEmployees = Array.from({ length: 125 }, (_, i) => ({
    id: randomUUID(),
    organizationId: a.organization.id,
    firstName: `Paged person ${String(i).padStart(3, "0")}`,
    lastName: "Fixture",
    email: randomUUID() + "@example.test",
    jobTitle: "List fixture",
    joinedAt: new Date("2026-01-01"),
    departmentId: record.departmentId,
    scheduleId: record.scheduleId,
  }));
  await db.employee.createMany({ data: listEmployees });
  const listLeaveType = await db.leaveType.findFirstOrThrow({
    where: { organizationId: a.organization.id },
  });
  const listOwner = await db.membership.findFirstOrThrow({
    where: { organizationId: a.organization.id, role: "OWNER" },
  });
  await db.leaveAllocation.createMany({
    data: listEmployees.map((e) => ({
      organizationId: a.organization.id,
      employeeId: e.id,
      leaveTypeId: listLeaveType.id,
      year: 2027,
      days: 1,
    })),
  });
  await db.leaveRequest.createMany({
    data: listEmployees.map((e) => ({
      organizationId: a.organization.id,
      employeeId: e.id,
      leaveTypeId: listLeaveType.id,
      startDate: "2027-01-04",
      endDate: "2027-01-04",
      days: 1,
      reason: `${collectionPrefix} leave`,
    })),
  });
  await db.payroll.createMany({
    data: listEmployees.map((e) => ({
      organizationId: a.organization.id,
      employeeId: e.id,
      period: "2098-01",
      baseMinor: 100n,
      netMinor: 100n,
      createdBy: listOwner.userId,
    })),
  });
  await db.notification.createMany({
    data: listEmployees.map((_, i) => ({
      organizationId: a.organization.id,
      userId: listOwner.userId,
      title: `${collectionPrefix} notification ${i}`,
      body: "List fixture",
    })),
  });
  await db.audit.createMany({
    data: listEmployees.map((e) => ({
      organizationId: a.organization.id,
      actorId: listOwner.userId,
      action: `${collectionPrefix} audit`,
      entityId: e.id,
    })),
  });
  const taskFixtures = Array.from({ length: 125 }, (_, i) => ({
    id: randomUUID(),
    organizationId: a.organization.id,
    employeeId: record.id,
    title: `${collectionPrefix} task ${i}`,
    dueDate: new Date("2026-12-01"),
  }));
  const assetFixtures = Array.from({ length: 125 }, (_, i) => ({
    id: randomUUID(),
    organizationId: a.organization.id,
    identifier: randomUUID(),
    name: `${collectionPrefix} asset ${i}`,
  }));
  const documentFixtures = Array.from({ length: 125 }, (_, i) => ({
    id: randomUUID(),
    organizationId: a.organization.id,
    employeeId: record.id,
    name: `${collectionPrefix} document ${i}`,
    category: "Pagination fixture",
    storageKey: randomUUID(),
    mime: "text/plain",
    bytes: 1,
    uploadedBy: "isolated-browser",
  }));
  await db.task.createMany({ data: taskFixtures });
  await db.asset.createMany({ data: assetFixtures });
  await db.document.createMany({ data: documentFixtures });
  for (const [navigation, searchLabel, path, kind, selector = "tbody tr"] of [
    ["Tasks & Assignments", "Search tasks", "tasks", "task"],
    ["Company Assets", "Search assets", "assets", "asset"],
    ["Documents", "Search documents", "documents", "document"],
    ["Leave Management", "Search leave requests", "leave", "leave"],
    ["Payroll", "Search payroll", "payroll", "payroll"],
    [
      "Notifications",
      "Search notifications",
      "notifications",
      "notification",
      ".saas-notifications article",
    ],
    ["Audit Logs", "Search audit", "audit", "audit"],
  ]) {
    await nav(owner, navigation);
    await owner
      .getByLabel(searchLabel, { exact: true })
      .fill(kind === "payroll" ? "2098-01" : `${collectionPrefix} ${kind}`);
    const pagination = owner.locator(".pagination").last();
    await expect(pagination).toContainText("125 records");
    await expect(owner.locator(selector)).toHaveCount(20);
    const firstRows = await owner.locator(selector).allTextContents();
    const next = responseFor(owner, (response) => {
      const url = new URL(response.url());
      return (
        url.pathname.endsWith("/" + path) &&
        url.searchParams.get("page") === "2"
      );
    });
    await pagination
      .getByRole("button", { name: "Next page", exact: true })
      .click();
    assert.ok(new URL((await next).url()).searchParams.get("after"));
    await expect
      .poll(() => owner.locator(selector).allTextContents())
      .not.toEqual(firstRows);
    await expect(owner.locator(selector)).toHaveCount(20);
    assert.equal(
      (await owner.locator(selector).allTextContents()).filter((row) =>
        firstRows.includes(row),
      ).length,
      0,
    );
    await pagination
      .getByRole("button", { name: "Previous page", exact: true })
      .click();
    await expect
      .poll(() => owner.locator(selector).allTextContents())
      .toEqual(firstRows);
  }
  const listEmployeeScope = {
    organizationId: a.organization.id,
    employeeId: { in: listEmployees.map((e) => e.id) },
  };
  await db.leaveRequest.deleteMany({ where: listEmployeeScope });
  await db.leaveAllocation.deleteMany({ where: listEmployeeScope });
  await db.payroll.deleteMany({ where: listEmployeeScope });
  await db.employee.deleteMany({
    where: {
      organizationId: a.organization.id,
      id: { in: listEmployees.map((e) => e.id) },
    },
  });
  await db.notification.deleteMany({
    where: {
      organizationId: a.organization.id,
      title: { startsWith: collectionPrefix },
    },
  });
  await db.audit.deleteMany({
    where: {
      organizationId: a.organization.id,
      action: { startsWith: collectionPrefix },
    },
  });
  await db.task.deleteMany({
    where: {
      organizationId: a.organization.id,
      id: { in: taskFixtures.map((item) => item.id) },
    },
  });
  await db.asset.deleteMany({
    where: {
      organizationId: a.organization.id,
      id: { in: assetFixtures.map((item) => item.id) },
    },
  });
  await db.document.deleteMany({
    where: {
      organizationId: a.organization.id,
      id: { in: documentFixtures.map((item) => item.id) },
    },
  });
  const scheduleFixtures = Array.from({ length: 125 }, (_, i) => ({
    id: randomUUID(),
    organizationId: a.organization.id,
    name: `${collectionPrefix} schedule ${String(i).padStart(3, "0")}`,
    timezone: "UTC",
    workingDays: [1, 2, 3, 4, 5],
    startMinute: 540,
    endMinute: 1020,
  }));
  const leaveTypeFixtures = Array.from({ length: 125 }, (_, i) => ({
    id: randomUUID(),
    organizationId: a.organization.id,
    name: `${collectionPrefix} leave type ${String(i).padStart(3, "0")}`,
  }));
  await db.schedule.createMany({ data: scheduleFixtures });
  await db.leaveType.createMany({ data: leaveTypeFixtures });
  const configurationStartupPages = [];
  const recordConfigurationPage = (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/directory-options")
      configurationStartupPages.push(Number(url.searchParams.get("page")));
  };
  owner.on("request", recordConfigurationPage);
  const startupOptions = responseFor(
    owner,
    (response) =>
      new URL(response.url()).pathname === "/api/directory-options" &&
      response.ok(),
  );
  await owner.reload();
  const configuration = await (await startupOptions).json();
  assert.equal(configuration.schedules.length, 100);
  assert.equal(configuration.current.schedule.timezone, "Africa/Lagos");
  assert.ok(
    !configuration.schedules.some(
      (item) => item.id === configuration.current.schedule.id,
    ),
  );
  await nav(owner, "Settings");
  for (const [title, searchLabel, kind, selector, path] of [
    [
      "Work schedules",
      "Search schedules",
      "schedule",
      ".schedule-list > div",
      "schedules",
    ],
    [
      "Leave policies",
      "Search leave types",
      "leave type",
      ".policy-chips > *",
      "leave-types",
    ],
  ]) {
    const panel = owner.locator(".panel").filter({
      has: owner.getByRole("heading", { name: title, exact: true }),
    });
    await panel
      .getByLabel(searchLabel, { exact: true })
      .fill(`${collectionPrefix} ${kind}`);
    await expect(panel.locator(".pagination")).toContainText("125 records");
    await expect(panel.locator(selector)).toHaveCount(20);
    const firstRows = await panel.locator(selector).allTextContents();
    const next = responseFor(owner, (response) => {
      const url = new URL(response.url());
      return (
        url.pathname === `/api/${path}` &&
        url.searchParams.has("after") &&
        response.ok()
      );
    });
    await panel.getByRole("button", { name: "Next page", exact: true }).click();
    await next;
    await expect(panel.locator(".pagination")).toContainText("Page 2 of 7");
    await expect
      .poll(() => panel.locator(selector).allTextContents())
      .not.toEqual(firstRows);
    assert.equal(
      (await panel.locator(selector).allTextContents()).filter((row) =>
        firstRows.includes(row),
      ).length,
      0,
    );
    await panel
      .getByRole("button", { name: "Previous page", exact: true })
      .click();
    await expect
      .poll(() => panel.locator(selector).allTextContents())
      .toEqual(firstRows);
  }
  assert.ok(
    configurationStartupPages.length > 0 &&
      configurationStartupPages.every((page) => page === 1),
    "Startup must not traverse configuration collections",
  );
  owner.off("request", recordConfigurationPage);
  await db.leaveAllocation.createMany({
    data: leaveTypeFixtures.map((t) => ({
      organizationId: a.organization.id,
      employeeId: listOwner.employeeId,
      leaveTypeId: t.id,
      year: new Date().getUTCFullYear(),
      days: 3,
    })),
  });
  await nav(owner, "Leave Management");
  await expect(owner.locator(".balance-card")).toHaveCount(20);
  const balancePagination = owner
    .locator(".pagination")
    .filter({ hasText: "125 records" });
  await expect(balancePagination).toBeVisible();
  const firstBalances = await owner.locator(".balance-card").allTextContents();
  const nextBalances = responseFor(owner, (response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/leave/balances" &&
      url.searchParams.has("after") &&
      response.ok()
    );
  });
  await balancePagination
    .getByRole("button", { name: "Next page", exact: true })
    .click();
  await nextBalances;
  await expect(balancePagination).toContainText("Page 2 of 7");
  await expect
    .poll(() => owner.locator(".balance-card").allTextContents())
    .not.toEqual(firstBalances);
  assert.equal(
    (await owner.locator(".balance-card").allTextContents()).filter((row) =>
      firstBalances.includes(row),
    ).length,
    0,
  );
  await balancePagination
    .getByRole("button", { name: "Previous page", exact: true })
    .click();
  await expect
    .poll(() => owner.locator(".balance-card").allTextContents())
    .toEqual(firstBalances);
  await db.leaveAllocation.deleteMany({
    where: {
      organizationId: a.organization.id,
      employeeId: listOwner.employeeId,
      leaveTypeId: { in: leaveTypeFixtures.map((t) => t.id) },
    },
  });
  await db.schedule.deleteMany({
    where: {
      organizationId: a.organization.id,
      id: { in: scheduleFixtures.map((item) => item.id) },
    },
  });
  await db.leaveType.deleteMany({
    where: {
      organizationId: a.organization.id,
      id: { in: leaveTypeFixtures.map((item) => item.id) },
    },
  });
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
  ownerB.on("pageerror", (error) => errors.push(error.message));
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
  const platformFixtures = Array.from({ length: 125 }, (_, i) => ({
    id: randomUUID(),
    name: `Browser directory ${suffix} ${i}`,
    slug: randomUUID(),
    businessEmail: `directory-${i}@example.test`,
    status: "Active",
  }));
  await db.organization.createMany({ data: platformFixtures });
  organizations.push(...platformFixtures.map((org) => org.id));
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
  platform.on("pageerror", (error) => errors.push(error.message));
  await login(platform, platformEmail);
  await expect(platform).toHaveURL(/\/platform-security$/);
  await platform
    .getByLabel("Platform password", { exact: true })
    .fill(password);
  await platform
    .getByRole("button", { name: "Set up authenticator", exact: true })
    .click();
  const secret = await platform.locator("code").first().textContent();
  await platform
    .getByLabel("Platform password", { exact: true })
    .fill(password);
  await platform
    .getByLabel("Authenticator or recovery code", { exact: true })
    .fill(totp(secret));
  await platform
    .getByRole("button", { name: "Confirm authenticator", exact: true })
    .click();
  await expect(platform.locator("li code")).toHaveCount(10);
  await platform
    .getByRole("button", { name: "I saved my recovery codes", exact: true })
    .click();
  await expect(platform).toHaveURL(/\/platform$/);
  await expect(
    platform.getByRole("heading", { name: "Companies, connected." }),
  ).toBeVisible();
  const organisationDirectory = platform
    .locator(".panel")
    .filter({
      has: platform.getByRole("heading", {
        name: "Organisation directory",
        exact: true,
      }),
    })
    .last();
  await platform
    .getByLabel("Search companies", { exact: true })
    .fill(`Browser directory ${suffix}`);
  await expect(organisationDirectory.locator("tbody tr").first()).toContainText(
    `Browser directory ${suffix}`,
  );
  await expect(organisationDirectory.locator("tbody tr")).toHaveCount(20);
  const firstPlatformRows = await organisationDirectory
    .locator("tbody tr")
    .allTextContents();
  const platformNext = responseFor(platform, (response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith("/platform/companies") &&
      url.searchParams.get("page") === "2"
    );
  });
  await organisationDirectory
    .getByRole("button", { name: "Next page", exact: true })
    .click();
  assert.ok(new URL((await platformNext).url()).searchParams.get("after"));
  await expect
    .poll(() => organisationDirectory.locator("tbody tr").allTextContents())
    .not.toEqual(firstPlatformRows);
  await expect(organisationDirectory.locator("tbody tr")).toHaveCount(20);
  await organisationDirectory
    .getByRole("button", { name: "Previous page", exact: true })
    .click();
  await expect
    .poll(() => organisationDirectory.locator("tbody tr").allTextContents())
    .toEqual(firstPlatformRows);
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
  await employee.setViewportSize({ width: 1440, height: 1050 });
  await nav(employee, "My Profile");
  await employee.getByLabel("Current password", { exact: true }).fill(password);
  await employee
    .getByLabel("New password", { exact: true })
    .fill(password + "Changed");
  await employee
    .getByLabel("Confirm new password", { exact: true })
    .fill(password + "Changed");
  await employee
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(
    employee.getByText(
      "Password changed. Other devices have been signed out.",
      { exact: true },
    ),
  ).toBeVisible();
  await employee
    .getByRole("button", { name: "Sign out all devices", exact: true })
    .click();
  dialog = employee.getByRole("dialog");
  await dialog
    .getByLabel("Current password", { exact: true })
    .fill(password + "Changed");
  await dialog
    .getByRole("button", { name: "Confirm sign-out", exact: true })
    .click();
  await expect(employee).toHaveURL(/\/login$/);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Chrome exercised SaaS workflows including bounded roster startup, remote selectors, collection/history cursors and filters — public registration, test-mail verification, resumable company onboarding, invitation and acceptance, employee login and clock-in/out, company monitoring, leave notification/approval, task notes/completion, private upload/report download, second-company isolation, aggregate-only platform suspension/reactivation mobile employee layout, platform MFA enrollment/recovery-code display and employee password change/all-device sign-out.",
  );
} finally {
  await browser.close();
  await cleanCompanies(db, organizations, extraUsers);
  await db.$disconnect();
}
