import { createRequire } from "node:module";
const { totp } = createRequire(import.meta.url)("../dist/src/totp.js");
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { hash, compare } from "bcryptjs";
import { randomBytes, createHash } from "node:crypto";
const db = new PrismaClient();
if (
  !/^\/flurryhr_test(?:_[a-z0-9]+)*$/i.test(
    new URL(process.env.DATABASE_URL || "postgresql://invalid/invalid")
      .pathname,
  )
)
  throw new Error("Use the isolated flurryhr_test database");
const base = process.env.TEST_API_URL || "http://127.0.0.1:4002/api",
  origin = process.env.TEST_WEB_URL || "http://localhost:5175",
  mailDir = process.env.TEST_MAIL_DIR || "/tmp/flurryhr-saas-mail";
const suffix = Date.now().toString(),
  password = "SaaS-Integration-Password-2026!";
let responseChecks = 0;
const organizations = [],
  users = [];
async function call(
  route,
  { cookie, method = "GET", data, status = 200, headers = {} } = {},
) {
  const response = await fetch(`${base}/${route}`, {
    method,
    headers: {
      Origin: origin,
      ...headers,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  assert.ok(
    (Array.isArray(status) ? status : [status]).includes(response.status),
    `${method} ${route}: ${response.status} ${text}`,
  );
  responseChecks++;
  const collectionRoutes = new Set([
    "departments",
    "announcements",
    "recruitment",
    "onboarding",
    "tasks",
    "audit",
    "documents",
    "assets",
    "performance",
    "performance/team",
    "attendance/corrections",
    "notifications",
    "holidays",
    "mail",
    "payroll",
  ]);
  if (
    method === "GET" &&
    (collectionRoutes.has(route.split("?")[0]) ||
      /^(tasks|assets)\/[^/]+\/history$/.test(route.split("?")[0])) &&
    body?.items
  )
    body = body.items;
  return {
    body,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
    response,
  };
}
async function mailToken(email, subject) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    for (const name of await fs.readdir(mailDir).catch(() => [])) {
      const message = JSON.parse(
        await fs.readFile(path.join(mailDir, name), "utf8"),
      );
      if (
        message.to === email.toLowerCase() &&
        message.subject.includes(subject)
      ) {
        const token = message.body.match(/#token=([A-Za-z0-9_%]+)/)?.[1];
        if (token) return decodeURIComponent(token);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Test mail not accepted for ${email}: ${subject}`);
}
async function company(label) {
  const email = `saas-${label}-${suffix}@example.test`.toLowerCase();
  const result = await call("auth/register", {
    method: "POST",
    status: 201,
    data: {
      fullName: `${label} Owner`,
      email,
      password,
      companyName: `SaaS API ${label} ${suffix}`,
      country: "NG",
    },
  });
  const actor = { ...result.body, cookie: result.cookie };
  organizations.push(actor.organization.id);
  users.push(actor.id);
  assert.equal(actor.platformAdmin, false);
  assert.equal(actor.role, "OWNER");
  assert.equal(actor.next, "/verify-email");
  await call("dashboard", { cookie: actor.cookie, status: 403 });
  const token = await mailToken(email, "Verify");
  await call("auth/verify", { method: "POST", status: 201, data: { token } });
  await call("auth/verify", { method: "POST", status: 400, data: { token } });
  const current = (await call("auth/me", { cookie: actor.cookie })).body;
  assert.equal(current.next, "/company-onboarding");
  await call("company", {
    method: "PATCH",
    cookie: actor.cookie,
    data: {
      name: actor.organization.name,
      businessEmail: email,
      country: "NG",
      timezone: "Africa/Lagos",
      address: "Test location",
      onboardingStep: 6,
      finish: true,
    },
  });
  actor.options = (
    await call("directory-options", { cookie: actor.cookie })
  ).body;
  return actor;
}
async function invite(
  owner,
  label,
  role = "EMPLOYEE",
  email = `saas-employee-${label}-${suffix}@example.test`,
) {
  const dto = {
    firstName: label,
    lastName: "Employee",
    email,
    jobTitle: "Engineer",
    departmentId: owner.options.departments[0].id,
    scheduleId: owner.options.schedules[0].id,
    role,
    employmentType: "Full-time",
    workArrangement: "Hybrid",
    joinedAt: "2026-11-18",
    managerId: owner.employee.id,
  };
  const item = (
    await call("invitations", {
      cookie: owner.cookie,
      method: "POST",
      status: 201,
      data: dto,
    })
  ).body;
  return { item, dto, token: await mailToken(email, owner.organization.name) };
}
try {
  const safety = await fetch(base + "/health");
  assert.equal(
    safety.headers.get("x-flurryhr-test-environment"),
    "isolated-file-mail",
    "Refusing to mutate a server without an isolated test database and file mail transport",
  );
  const a = await company("A"),
    b = await company("B");
  const prohibitedEmail = `privilege-attempt-${suffix}@example.test`;
  await call("auth/register", {
    method: "POST",
    status: 400,
    data: {
      fullName: "Privilege attempt",
      email: prohibitedEmail,
      password,
      companyName: "Privilege attempt",
      country: "NG",
      platformAdmin: true,
    },
  });
  assert.equal(await db.user.count({ where: { email: prohibitedEmail } }), 0);

  await call("auth/register", {
    method: "POST",
    status: 400,
    data: {
      fullName: "Duplicate",
      email: a.email,
      password,
      companyName: "Duplicate",
      country: "NG",
    },
  });
  const deptA = (
    await call("departments", {
      cookie: a.cookie,
      method: "POST",
      status: 201,
      data: { name: "Engineering" },
    })
  ).body;
  const deptB = (
    await call("departments", {
      cookie: b.cookie,
      method: "POST",
      status: 201,
      data: { name: "Engineering" },
    })
  ).body;
  assert.notEqual(deptA.organizationId, deptB.organizationId);
  const recordedEmployee = (
    await call("employees", {
      cookie: a.cookie,
      method: "POST",
      status: 201,
      data: {
        firstName: "Recorded",
        lastName: "Before invitation",
        email: `recorded-${suffix}@example.test`,
        jobTitle: "Engineer",
        departmentId: deptA.id,
        scheduleId: a.options.schedules[0].id,
        employmentType: "Full-time",
        workArrangement: "Hybrid",
        joinedAt: "2026-11-18",
      },
    })
  ).body;
  await call(`employees/${recordedEmployee.id}/invite`, {
    cookie: a.cookie,
    method: "POST",
    status: 201,
    data: {},
  });
  await call(`employees/${recordedEmployee.id}/invite`, {
    cookie: a.cookie,
    method: "POST",
    status: 400,
    data: {},
  });
  assert.equal(
    await db.employee.count({
      where: {
        organizationId: a.organization.id,
        email: recordedEmployee.email,
      },
    }),
    1,
  );
  const inviteA = await invite(a, "First");
  await call("invitations/accept", {
    cookie: b.cookie,
    method: "POST",
    status: 403,
    data: { token: inviteA.token, password },
  });
  await call("invitations/accept", {
    method: "POST",
    status: 201,
    data: { token: inviteA.token, password },
  });
  await call("invitations/accept", {
    method: "POST",
    status: 400,
    data: { token: inviteA.token, password },
  });
  const employee = await call("auth/login", {
    method: "POST",
    data: { email: inviteA.dto.email, password },
  });
  const e = { ...employee.body, cookie: employee.cookie };
  users.push(e.id);
  assert.equal(e.organization.id, a.organization.id);
  assert.equal(e.employee.id, inviteA.item.employeeId);
  await call("employees", { cookie: e.cookie, status: 403 });
  const managerInvite = await invite(a, "Manager", "MANAGER");
  await call("invitations/accept", {
    method: "POST",
    status: 201,
    data: { token: managerInvite.token, password },
  });
  const managerLogin = await call("auth/login", {
    method: "POST",
    data: { email: managerInvite.dto.email, password },
  });
  const manager = { ...managerLogin.body, cookie: managerLogin.cookie };
  users.push(manager.id);
  const editable = {
    firstName: e.employee.firstName,
    lastName: e.employee.lastName,
    email: e.employee.email,
    jobTitle: e.employee.jobTitle,
    departmentId: e.employee.departmentId,
    scheduleId: e.employee.scheduleId,
    managerId: manager.employee.id,
    employmentType: e.employee.employmentType,
    workArrangement: e.employee.workArrangement,
    joinedAt: e.employee.joinedAt,
  };
  await call(`employees/${e.employee.id}`, {
    cookie: a.cookie,
    method: "PATCH",
    data: editable,
  });
  await call(`employees/${a.employee.id}`, {
    cookie: manager.cookie,
    status: 404,
  });

  await call("platform/overview", { cookie: a.cookie, status: 403 });
  await call(`employees/${e.employee.id}`, { cookie: b.cookie, status: 404 });
  await call(`employees/${e.employee.id}/status`, {
    cookie: b.cookie,
    method: "PATCH",
    data: { status: "Inactive", reason: "Cross-company deactivation attempt" },
    status: 404,
  });
  await call("invitations", {
    cookie: a.cookie,
    method: "POST",
    status: [400, 409],
    data: {
      ...inviteA.dto,
      email: `bad-cross-${suffix}@example.test`,
      departmentId: deptB.id,
    },
  });
  await assert.rejects(
    db.employee.create({
      data: {
        organizationId: a.organization.id,
        firstName: "Wrong",
        lastName: "Tenant",
        email: `constraint-${suffix}@example.test`,
        jobTitle: "Invalid association",
        departmentId: deptB.id,
        scheduleId: a.options.schedules[0].id,
        joinedAt: new Date(),
      },
    }),
  );
  const sessions = await Promise.all(
    Array.from({ length: 5 }, () =>
      call("attendance/clock-in", {
        cookie: e.cookie,
        method: "POST",
        status: 201,
        data: {},
        headers: { "Idempotency-Key": `attendance-${suffix}-retry` },
      }),
    ),
  );
  assert.equal(new Set(sessions.map((x) => x.body.id)).size, 1);
  const session = sessions[0].body;
  assert.equal(session.organizationId, a.organization.id);
  assert.equal(
    (await call("dashboard", { cookie: a.cookie })).body.metrics.clockedIn,
    1,
  );
  assert.equal(
    (await call("dashboard", { cookie: b.cookie })).body.metrics.clockedIn,
    0,
  );
  await call(`attendance/clock-out/${session.id}`, {
    cookie: b.cookie,
    method: "POST",
    status: 400,
    data: {},
  });
  const closed = (
    await call(`attendance/clock-out/${session.id}`, {
      cookie: e.cookie,
      method: "POST",
      status: 201,
      data: {},
    })
  ).body;
  assert.equal(
    (
      await call(`attendance/clock-out/${session.id}`, {
        cookie: e.cookie,
        method: "POST",
        status: 201,
        data: {},
      })
    ).body.clockOut,
    closed.clockOut,
  );
  const delayedReplay = (
    await call("attendance/clock-in", {
      cookie: e.cookie,
      method: "POST",
      status: 201,
      data: {},
      headers: { "Idempotency-Key": `attendance-${suffix}-retry` },
    })
  ).body;
  assert.equal(delayedReplay.id, session.id);
  assert.equal(delayedReplay.clockOut, closed.clockOut);
  assert.equal(
    (await call("attendance/mine", { cookie: e.cookie })).body.active,
    null,
  );
  const summary = (
    await call(
      "attendance/summary?date=" +
        new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" }),
      { cookie: a.cookie },
    )
  ).body;
  assert.ok(summary.items.some((row) => row.employee.id === e.employee.id));
  assert.ok(summary.items.every((row) => row.employee.id !== b.employee.id));
  const correction = (
    await call("attendance/corrections", {
      cookie: e.cookie,
      method: "POST",
      status: 201,
      data: {
        attendanceId: session.id,
        requestedIn: new Date(Date.now() - 7200000).toISOString(),
        requestedOut: new Date(Date.now() - 3600000).toISOString(),
        reason: "Verified earlier work session",
      },
    })
  ).body;
  await call(`attendance/corrections/${correction.id}`, {
    cookie: b.cookie,
    method: "PATCH",
    status: 404,
    data: { status: "Approved", comment: "Wrong tenant" },
  });
  await call(`attendance/corrections/${correction.id}`, {
    cookie: a.cookie,
    method: "PATCH",
    data: { status: "Approved", comment: "Verified by manager" },
  });
  const leaveType = a.options.leaveTypes[0].id;
  await call("leave/allocations", {
    cookie: a.cookie,
    method: "POST",
    status: 201,
    data: {
      employeeId: e.employee.id,
      leaveTypeId: leaveType,
      year: 2026,
      days: 10,
    },
  });
  const leave = (
    await call("leave", {
      cookie: e.cookie,
      method: "POST",
      status: 201,
      data: {
        leaveTypeId: leaveType,
        startDate: "2026-12-07",
        endDate: "2026-12-08",
        reason: "Personal time away",
      },
    })
  ).body;
  await call(`leave/${leave.id}/decision`, {
    cookie: b.cookie,
    method: "PATCH",
    status: 404,
    data: { status: "Approved", comment: "Cross company attempt" },
  });
  await call(`leave/${leave.id}/decision`, {
    cookie: manager.cookie,
    method: "PATCH",
    data: { status: "Approved", comment: "Team coverage confirmed" },
  });
  await call(`leave/${leave.id}/decision`, {
    cookie: a.cookie,
    method: "PATCH",
    status: 400,
    data: { status: "Approved", comment: "Duplicate approval" },
  });
  assert.equal(
    (await call("leave", { cookie: e.cookie })).body.balances[0].remaining,
    8,
  );
  const notices = (await call("notifications", { cookie: e.cookie })).body;
  assert.ok(notices.some((n) => n.title === "Leave request reviewed"));
  await call(`leave/${leave.id}/reverse`, {
    cookie: a.cookie,
    method: "PATCH",
    data: { reason: "Employee changed plans" },
  });
  assert.equal(
    (await call("leave", { cookie: e.cookie })).body.balances[0].remaining,
    10,
  );
  const task = (
    await call("tasks", {
      cookie: a.cookie,
      method: "POST",
      status: 201,
      data: {
        employeeId: e.employee.id,
        title: "Prepare test handover",
        description: "Document the workflow",
        priority: "High",
        dueDate: "2026-12-01",
      },
    })
  ).body;
  await call(`tasks/${task.id}/notes`, {
    cookie: e.cookie,
    method: "POST",
    status: 201,
    data: { note: "Initial work is complete" },
  });
  await call(`tasks/${task.id}`, {
    cookie: e.cookie,
    method: "PATCH",
    data: { status: "Completed" },
  });
  assert.equal(
    (await call("tasks", { cookie: a.cookie })).body.find(
      (t) => t.id === task.id,
    ).status,
    "Completed",
  );
  assert.equal(
    (await call(`tasks/${task.id}/history`, { cookie: e.cookie })).body.length,
    3,
  );
  await call(`tasks/${task.id}`, {
    cookie: b.cookie,
    method: "PATCH",
    data: { status: "Blocked" },
    status: 404,
  });
  const mailBefore = await db.mailJob.count({
    where: { userId: e.id, organizationId: a.organization.id },
  });
  await call("profile", {
    cookie: e.cookie,
    method: "PATCH",
    data: { phone: "", emailNotifications: false },
  });
  assert.equal(
    (await call("auth/me", { cookie: e.cookie })).body.emailNotifications,
    false,
  );
  await call("tasks", {
    cookie: a.cookie,
    method: "POST",
    status: 201,
    data: {
      employeeId: e.employee.id,
      title: "Notification preference test",
      description: "In-app only",
      priority: "Low",
      dueDate: "2026-12-01",
    },
  });
  assert.equal(
    await db.mailJob.count({
      where: { userId: e.id, organizationId: a.organization.id },
    }),
    mailBefore,
  );
  assert.ok(
    (await call("notifications", { cookie: e.cookie })).body.some(
      (n) => n.title === "New task assigned",
    ),
  );
  const doc = (
    await call("documents", {
      cookie: a.cookie,
      method: "POST",
      status: 201,
      data: {
        name: "Private.txt",
        category: "Contract",
        employeeId: e.employee.id,
        mime: "text/plain",
        dataBase64: Buffer.from("Private test content").toString("base64"),
      },
    })
  ).body;
  assert.equal(
    (await call(`documents/${doc.id}/download`, { cookie: e.cookie })).body,
    "Private test content",
  );
  await call(`documents/${doc.id}/download`, { cookie: b.cookie, status: 404 });
  assert.equal((await call("documents", { cookie: b.cookie })).body.length, 0);
  const asset = (
    await call("assets", {
      cookie: a.cookie,
      method: "POST",
      status: 201,
      data: { identifier: "LAPTOP-TEST", name: "Test laptop" },
    })
  ).body;
  await call(`assets/${asset.id}/assignment`, {
    cookie: a.cookie,
    method: "PATCH",
    data: { employeeId: e.employee.id, reason: "New equipment assignment" },
  });
  await call(`assets/${asset.id}/assignment`, {
    cookie: a.cookie,
    method: "PATCH",
    status: 400,
    data: { employeeId: e.employee.id, reason: "Duplicate assignment" },
  });
  await call(`assets/${asset.id}/assignment`, {
    cookie: b.cookie,
    method: "PATCH",
    status: 404,
    data: { reason: "Cross tenant return" },
  });
  await call(`assets/${asset.id}/assignment`, {
    cookie: a.cookie,
    method: "PATCH",
    data: { reason: "Equipment returned" },
  });
  assert.equal(
    (await call(`assets/${asset.id}/history`, { cookie: a.cookie })).body
      .length,
    2,
  );
  const review = (
    await call("performance", {
      cookie: a.cookie,
      method: "POST",
      status: 201,
      data: {
        employeeId: e.employee.id,
        period: "2026 Q4",
        goal: "Complete the onboarding workflow",
      },
    })
  ).body;
  await call(`performance/${review.id}/self`, {
    cookie: e.cookie,
    method: "PATCH",
    data: { assessment: "I completed the assigned onboarding workflow." },
  });
  await call(`performance/${review.id}/manager`, {
    cookie: a.cookie,
    method: "PATCH",
    data: {
      assessment: "The workflow was completed with the required evidence.",
    },
  });
  assert.equal(
    (await call("performance", { cookie: e.cookie })).body[0].status,
    "Completed",
  );
  const payroll = (
    await call("payroll", {
      cookie: a.cookie,
      method: "POST",
      status: 201,
      data: {
        employeeId: e.employee.id,
        period: "2026-11",
        baseMinor: "100000",
        allowancesMinor: "200",
        deductionsMinor: "50",
      },
    })
  ).body;
  await call(`payroll/${payroll.id}/approve`, {
    cookie: b.cookie,
    method: "PATCH",
    data: {},
    status: 404,
  });
  assert.equal((await call("payroll", { cookie: b.cookie })).body.length, 0);
  const financeInvite = await invite(a, "Finance", "FINANCE");
  await call("invitations/accept", {
    method: "POST",
    status: 201,
    data: { token: financeInvite.token, password },
  });
  const financeLogin = await call("auth/login", {
    method: "POST",
    data: { email: financeInvite.dto.email, password },
  });
  users.push(financeLogin.body.id);
  await call(`payroll/${payroll.id}/approve`, {
    cookie: a.cookie,
    method: "PATCH",
    status: 403,
    data: {},
  });
  await call(`payroll/${payroll.id}/approve`, {
    cookie: financeLogin.cookie,
    method: "PATCH",
    data: {},
  });
  assert.equal(
    (await call("payroll", { cookie: e.cookie })).body[0].netMinor,
    "100150",
  );
  const job = (
    await call("jobs", {
      cookie: a.cookie,
      method: "POST",
      status: 201,
      data: {
        title: "Lifecycle engineer",
        department: "Engineering",
        description: "Test accepted offer lifecycle",
        workArrangement: "Hybrid",
      },
    })
  ).body;
  const candidate = (
    await call("candidates", {
      cookie: a.cookie,
      method: "POST",
      status: 201,
      data: {
        name: "Hired Candidate",
        email: `candidate-${suffix}@example.test`,
        jobId: job.id,
      },
    })
  ).body;
  const ownerEmployee = await db.employee.findFirstOrThrow({
    where: { organizationId: a.organization.id, userId: a.id },
  });
  const fullNameQuery = encodeURIComponent(
    `${ownerEmployee.firstName} ${ownerEmployee.lastName}`,
  );
  assert.ok(
    (
      await call(`directory-options/employees?search=${fullNameQuery}`, {
        cookie: a.cookie,
      })
    ).body.items.some((item) => item.id === ownerEmployee.id),
  );
  assert.ok(
    (
      await call(`directory-options?search=${fullNameQuery}`, {
        cookie: a.cookie,
      })
    ).body.employees.some((item) => item.id === ownerEmployee.id),
  );
  const employeeLookup = (
    await call("directory-options/employees?search=", { cookie: a.cookie })
  ).body;
  assert.ok(employeeLookup.total > 0);
  await call("directory-options/employees", { cookie: e.cookie, status: 403 });
  await call("directory-options/not-real", { cookie: a.cookie, status: 400 });
  const candidatePage = (
    await call(`jobs/${job.id}/candidates?search=Hired`, { cookie: a.cookie })
  ).body;
  assert.equal(candidatePage.total, 1);
  assert.equal(candidatePage.items[0].id, candidate.id);
  await call(`jobs/${job.id}/candidates`, { cookie: e.cookie, status: 403 });
  await call(`jobs/${job.id}/candidates`, { cookie: b.cookie, status: 404 });
  await call(`jobs/${job.id}/candidates?limit=101`, {
    cookie: a.cookie,
    status: 400,
  });
  await call(`candidates/${candidate.id}/convert`, {
    cookie: a.cookie,
    method: "POST",
    status: 400,
    data: {
      departmentId: deptA.id,
      scheduleId: a.options.schedules[0].id,
      joinedAt: "2026-11-18",
    },
  });
  await call(`candidates/${candidate.id}/stage`, {
    cookie: a.cookie,
    method: "PATCH",
    data: { stage: "Offer", offerAccepted: true },
  });
  const hire = (
    await call(`candidates/${candidate.id}/convert`, {
      cookie: a.cookie,
      method: "POST",
      status: 201,
      data: {
        departmentId: deptA.id,
        scheduleId: a.options.schedules[0].id,
        joinedAt: "2026-11-18",
      },
    })
  ).body;
  assert.equal(hire.status, "Invited");
  assert.equal(
    await db.invitation.count({
      where: {
        organizationId: a.organization.id,
        employeeId: hire.id,
        status: "Pending",
      },
    }),
    1,
  );
  assert.equal(
    await db.onboardingItem.count({ where: { employeeId: hire.id } }),
    8,
  );
  const report = await call(
    "reports/attendance?from=2026-11-01&to=2026-11-30",
    { cookie: b.cookie },
  );
  assert.ok(!report.body.includes(inviteA.dto.email));
  assert.ok(!report.body.includes("First Employee"));
  const existingInvite = await invite(b, "Second", "EMPLOYEE", e.email);
  await call("invitations/accept", {
    cookie: a.cookie,
    method: "POST",
    status: 403,
    data: { token: existingInvite.token },
  });
  await call("invitations/accept", {
    cookie: e.cookie,
    method: "POST",
    status: 201,
    data: { token: existingInvite.token },
  });
  const switched = (await call("auth/me", { cookie: e.cookie })).body;
  assert.equal(switched.organization.id, b.organization.id);
  assert.equal(switched.memberships.length, 2);
  await call("auth/switch", {
    cookie: e.cookie,
    method: "POST",
    data: { membershipId: a.membershipId },
    status: 403,
  });
  await call("auth/switch", {
    cookie: e.cookie,
    method: "POST",
    data: {
      membershipId: switched.memberships.find(
        (m) => m.organization.id === a.organization.id,
      ).id,
    },
  });
  const revoked = await invite(a, "Revoked");
  await call(`invitations/${revoked.item.id}/revoke`, {
    cookie: a.cookie,
    method: "POST",
    status: 201,
    data: {},
  });
  await call("invitations/accept", {
    method: "POST",
    status: 400,
    data: { token: revoked.token, password },
  });
  const expired = await invite(a, "Expired");
  await db.invitation.update({
    where: { id: expired.item.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await call("invitations/accept", {
    method: "POST",
    status: 400,
    data: { token: expired.token, password },
  });
  const invitationCount = await db.invitation.count({
    where: { employeeId: expired.item.employeeId },
  });
  await call(`invitations/${expired.item.id}/resend`, {
    cookie: a.cookie,
    method: "POST",
    status: 201,
    data: {},
  });
  assert.equal(
    await db.invitation.count({
      where: { employeeId: expired.item.employeeId },
    }),
    invitationCount,
    "Resend must not create another invitation row",
  );
  const resent = await db.invitation.findUniqueOrThrow({
    where: { id: expired.item.id },
  });
  assert.equal(resent.status, "Pending");
  assert.ok(resent.expiresAt > new Date());
  await call("invitations/accept", {
    method: "POST",
    status: 400,
    data: { token: expired.token, password },
  });
  await call(`employees/${e.employee.id}/status`, {
    cookie: a.cookie,
    method: "PATCH",
    data: {
      status: "Inactive",
      reason: "Isolated offboarding verification",
      exitDate: "2026-11-18",
    },
  });
  await call("auth/me", { cookie: e.cookie, status: 401 });
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: e.id } })).active,
    true,
    "Other company access must not be globally deactivated",
  );
  assert.equal(
    await db.onboardingItem.count({
      where: { employeeId: e.employee.id, title: { startsWith: "Exit:" } },
    }),
    4,
  );
  const remainingLogin = await call("auth/login", {
    method: "POST",
    data: { email: e.email, password },
  });
  assert.equal(remainingLogin.body.organization.id, b.organization.id);
  await call(`employees/${e.employee.id}/status`, {
    cookie: a.cookie,
    method: "PATCH",
    data: { status: "Active" },
  });
  await call("auth/forgot-password", {
    method: "POST",
    status: 201,
    data: { email: e.email },
  });
  const reset = await mailToken(e.email, "Reset");
  await call("auth/reset-password", {
    method: "POST",
    status: 201,
    data: { token: reset, password: password + "New" },
  });
  await call("auth/me", { cookie: remainingLogin.cookie, status: 401 });
  await call("auth/reset-password", {
    method: "POST",
    status: 400,
    data: { token: reset, password: password + "New" },
  });
  const platformEmail = `saas-platform-${suffix}@example.test`;
  const platform = await db.user.create({
    data: {
      email: platformEmail,
      passwordHash: await hash(password, 4),
      emailVerifiedAt: new Date(),
      platformAdmin: true,
    },
  });
  users.push(platform.id);
  const platformCookie = (
    await call("auth/login", {
      method: "POST",
      data: { email: platformEmail, password },
    })
  ).cookie;
  await call("platform/overview", { cookie: platformCookie, status: 403 });
  await call("auth/mfa/enroll", {
    cookie: a.cookie,
    method: "POST",
    status: 403,
    data: { currentPassword: password },
  });
  const enrollment = (
    await call("auth/mfa/enroll", {
      cookie: platformCookie,
      method: "POST",
      status: 201,
      data: { currentPassword: password },
    })
  ).body;
  assert.ok(enrollment.secret && !enrollment.secret.includes("."));
  await call("auth/mfa/confirm", {
    cookie: platformCookie,
    method: "POST",
    status: 400,
    data: { currentPassword: password, code: "abcdef" },
  });
  const enrollmentCode = totp(enrollment.secret);
  const confirmation = (
    await call("auth/mfa/confirm", {
      cookie: platformCookie,
      method: "POST",
      status: 201,
      data: { currentPassword: password, code: enrollmentCode },
    })
  ).body;
  assert.equal(confirmation.recoveryCodes.length, 10);
  assert.ok(
    (await db.user.findUniqueOrThrow({ where: { id: platform.id } }))
      .mfaSecretEncrypted !== enrollment.secret,
  );
  const storedCodes = await db.mfaRecoveryCode.findMany({
    where: { userId: platform.id },
  });
  assert.ok(
    storedCodes.every(
      (stored) => !confirmation.recoveryCodes.includes(stored.hash),
    ),
  );
  await call("auth/mfa/verify", {
    cookie: platformCookie,
    method: "POST",
    status: 400,
    data: { currentPassword: password, code: enrollmentCode },
  });
  await call("auth/mfa/verify", {
    cookie: platformCookie,
    method: "POST",
    status: 201,
    data: { currentPassword: password, code: confirmation.recoveryCodes[0] },
  });
  await call("auth/mfa/verify", {
    cookie: platformCookie,
    method: "POST",
    status: 400,
    data: { currentPassword: password, code: confirmation.recoveryCodes[0] },
  });
  const platformSessionId = (
    await call("account/sessions", { cookie: platformCookie })
  ).body.items.find((item) => item.current).id;
  await db.session.update({
    where: { id: platformSessionId },
    data: { mfaVerifiedAt: new Date(Date.now() - 31 * 60000) },
  });
  await call("platform/overview", { cookie: platformCookie, status: 403 });
  const recoveryRace = await Promise.all(
    [0, 1].map(() =>
      call("auth/mfa/verify", {
        cookie: platformCookie,
        method: "POST",
        status: [201, 400],
        data: {
          currentPassword: password,
          code: confirmation.recoveryCodes[1],
        },
      }),
    ),
  );
  assert.deepEqual(
    recoveryRace.map((result) => result.response.status).sort(),
    [201, 400],
  );
  const directory = (
    await call("platform/companies", { cookie: platformCookie })
  ).body;
  assert.ok(directory.items.some((c) => c.id === a.organization.id));
  assert.ok(!JSON.stringify(directory).includes("baseMinor"));
  await call("employees", { cookie: platformCookie, status: 403 });
  await call("payroll", { cookie: platformCookie, status: 403 });
  await call("documents", { cookie: platformCookie, status: 403 });
  await call(`platform/companies/${a.organization.id}/status`, {
    cookie: platformCookie,
    method: "PATCH",
    data: {
      status: "Suspended",
      reason: "Isolated suspension policy verification",
      password,
    },
  });
  await call("dashboard", { cookie: a.cookie, status: 403 });
  await call(`platform/companies/${a.organization.id}/status`, {
    cookie: platformCookie,
    method: "PATCH",
    data: {
      status: "Active",
      reason: "Isolated reactivation policy verification",
      password,
    },
  });
  await call("dashboard", { cookie: a.cookie });
  assert.equal(
    await db.platformAudit.count({
      where: {
        organizationId: a.organization.id,
        action: { in: ["company.suspended", "company.reactivated"] },
      },
    }),
    2,
  );
  await call("auth/mfa/reset", {
    cookie: platformCookie,
    method: "POST",
    status: 201,
    data: { currentPassword: password, code: confirmation.recoveryCodes[2] },
  });
  await call("platform/overview", { cookie: platformCookie, status: 403 });
  assert.equal(
    await db.mfaRecoveryCode.count({ where: { userId: platform.id } }),
    0,
  );
  assert.equal(
    (await call("auth/me", { cookie: platformCookie })).body.next,
    "/platform-security",
  );
  const mfaEvents = await db.platformAudit.findMany({
    where: { actorId: platform.id },
  });
  for (const action of [
    "mfa.enabled",
    "mfa.failed",
    "mfa.recovery_used",
    "mfa.reset",
  ])
    assert.ok(mfaEvents.some((event) => event.action === action));
  assert.ok(!JSON.stringify(mfaEvents).includes(enrollment.secret));
  // Migrated SUPER_ADMIN memberships are legacy company owners, not platform
  // identities; another HR/owner must not offboard or demote that owner.
  await db.membership.update({
    where: { id: a.membershipId },
    data: { role: "SUPER_ADMIN" },
  });
  try {
    await db.membership.update({
      where: { id: manager.membershipId },
      data: { role: "HR_ADMIN" },
    });
    await call(`employees/${a.employee.id}/status`, {
      cookie: manager.cookie,
      method: "PATCH",
      status: 403,
      data: {
        status: "Inactive",
        reason: "Isolated last-owner protection check",
        exitDate: new Date().toISOString().slice(0, 10),
      },
    });
    assert.equal(
      (await db.employee.findUniqueOrThrow({ where: { id: a.employee.id } }))
        .status,
      "Active",
    );
    assert.equal(
      (await db.membership.findUniqueOrThrow({ where: { id: a.membershipId } }))
        .active,
      true,
    );
    await db.membership.update({
      where: { id: manager.membershipId },
      data: { role: "OWNER" },
    });
    await call(`employees/${a.employee.id}/role`, {
      cookie: manager.cookie,
      method: "PATCH",
      status: 403,
      data: { role: "EMPLOYEE" },
    });
    assert.equal(
      (await db.membership.findUniqueOrThrow({ where: { id: a.membershipId } }))
        .role,
      "SUPER_ADMIN",
    );
  } finally {
    await db.membership.update({
      where: { id: a.membershipId },
      data: { role: "OWNER" },
    });
    await db.membership.update({
      where: { id: manager.membershipId },
      data: { role: "MANAGER" },
    });
  }
  // Account security uses the same global identity/session store, without
  // creating extra login requests that would exhaust shared auth rate limits.
  const extraToken = randomBytes(32).toString("hex"),
    extraId = createHash("sha256").update(extraToken).digest("hex");
  await db.session.create({
    data: {
      id: extraId,
      userId: a.id,
      membershipId: a.membershipId,
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const ownSessions = (await call("account/sessions", { cookie: a.cookie }))
    .body;
  assert.ok(ownSessions.items.some((item) => item.id === extraId));
  assert.ok(ownSessions.items.some((item) => item.current));
  await call(`account/sessions/${extraId}/revoke`, {
    cookie: b.cookie,
    method: "POST",
    status: 400,
    data: { currentPassword: password },
  });
  assert.ok(await db.session.findUnique({ where: { id: extraId } }));
  await call("account/sessions/revoke-others", {
    cookie: a.cookie,
    method: "POST",
    status: 403,
    data: { currentPassword: "incorrect" },
  });
  await call("account/sessions/revoke-others", {
    cookie: a.cookie,
    method: "POST",
    status: 201,
    data: { currentPassword: password },
  });
  await call("auth/me", {
    cookie: `flurry_session=${extraToken}`,
    status: 401,
  });
  const staleReset = randomBytes(32).toString("hex");
  await db.accountToken.create({
    data: {
      userId: a.id,
      kind: "Reset",
      hash: createHash("sha256").update(staleReset).digest("hex"),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  await call("account/password", {
    cookie: a.cookie,
    method: "POST",
    status: 403,
    data: { currentPassword: "incorrect", newPassword: password + "Security" },
  });
  await call("account/password", {
    cookie: a.cookie,
    method: "POST",
    status: 201,
    data: { currentPassword: password, newPassword: password + "Security" },
  });
  assert.ok(
    await compare(
      password + "Security",
      (await db.user.findUniqueOrThrow({ where: { id: a.id } })).passwordHash,
    ),
  );
  await call("auth/reset-password", {
    method: "POST",
    status: 400,
    data: { token: staleReset, password: password + "Overwrite" },
  });
  await call("auth/me", { cookie: a.cookie });
  await call("account/sessions/sign-out-all", {
    cookie: a.cookie,
    method: "POST",
    status: 201,
    data: { currentPassword: password + "Security" },
  });
  await call("auth/me", { cookie: a.cookie, status: 401 });
  console.log(`HTTP response checks passed: ${responseChecks}`);
  console.log(
    "PASS: connected SaaS API/database journeys — two companies; verification and single-use tokens; onboarding; invitation identity/revoke/expiry/resend; membership switching; concurrent attendance and correction; leave reserve/approval/reversal and notifications; task history; private files; asset integrity; performance; payroll/export isolation; reset/session revocation; aggregate-only platform suspension/reactivation; password/session security; mandatory platform MFA enrollment, replay denial, concurrent recovery-code consumption, expiry, reset and audited failures. No real email sent.",
  );
} finally {
  for (const organizationId of organizations) {
    const memberships = await db.membership.findMany({
      where: { organizationId },
    });
    users.push(...memberships.map((m) => m.userId));
    const docs = await db.document.findMany({ where: { organizationId } });
    for (const doc of docs)
      await fs
        .unlink(
          path.join(
            process.env.DOCUMENT_STORAGE_DIR || "/tmp/flurryhr-saas-documents",
            doc.storageKey,
          ),
        )
        .catch(() => {});
    await db.session.deleteMany({
      where: { membershipId: { in: memberships.map((m) => m.id) } },
    });
    for (const table of [
      "notification",
      "taskEvent",
      "assetHistory",
      "performanceReview",
      "document",
      "asset",
      "correction",
      "attendance",
      "invitation",
      "payroll",
      "leaveRequest",
      "leaveAllocation",
      "onboardingItem",
      "task",
      "candidate",
      "job",
    ])
      await db[table].deleteMany({ where: { organizationId } });
    await db.membership.deleteMany({ where: { organizationId } });
    await db.employee.updateMany({
      where: { organizationId },
      data: { managerId: null },
    });
    await db.employee.deleteMany({ where: { organizationId } });
    for (const table of [
      "holiday",
      "leaveType",
      "department",
      "schedule",
      "audit",
    ])
      await db[table].deleteMany({ where: { organizationId } });
    await db.mailJob.deleteMany({ where: { organizationId } });
    await db.platformAudit.deleteMany({ where: { organizationId } });
    await db.organization.delete({ where: { id: organizationId } });
  }
  const removable = await db.user.findMany({
    where: { id: { in: [...new Set(users)] }, memberships: { none: {} } },
  });
  const ids = removable.map((u) => u.id);
  await db.mailJob.deleteMany({ where: { userId: { in: ids } } });
  await db.platformAudit.deleteMany({ where: { actorId: { in: ids } } });
  await db.session.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
}
