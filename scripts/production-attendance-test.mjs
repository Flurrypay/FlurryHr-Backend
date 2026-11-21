import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { cleanCompanies } from "./test-support.mjs";
const require = createRequire(import.meta.url);
const { Db, tenantContext } = require("../dist/src/db.js");
const {
  AttendanceCalculation,
} = require("../dist/src/attendance-calculation.js");
const { CompanyController } = require("../dist/src/company.js");
const { DashboardController } = require("../dist/src/dashboard.js");
const {
  AccountSecurityController,
} = require("../dist/src/account-security.js");
const { PlatformController } = require("../dist/src/platform.js");
const { HrController } = require("../dist/src/hr.js");
const { AttendanceController } = require("../dist/src/attendance.js");
const { dayAttendanceStatus, shiftWindow } = require("../dist/src/domain.js");
const { ResourcesController } = require("../dist/src/resources.js");
if (
  !/^\/flurryhr_test(?:_[a-z0-9]+)*$/i.test(
    new URL(process.env.DATABASE_URL || "postgresql://invalid/invalid")
      .pathname,
  )
)
  throw Error("Isolated test database required");
const db = new Db(),
  sys = db.system,
  organizations = [],
  fixtureUsers = [];
let checks = 0;
const check = (actual, expected) => {
  assert.deepEqual(actual, expected);
  checks++;
};
try {
  const organization = await sys.organization.create({
    data: {
      name: "Attendance regression",
      slug: "regression-" + randomUUID(),
      businessEmail: "fixture@example.test",
      status: "Active",
    },
  });
  organizations.push(organization.id);
  check(organization.createdAt.getTime() <= Date.now() + 1000, true);
  const org = organization.id;
  const department = await sys.department.create({
    data: { organizationId: org, name: "Test" },
  });
  const schedule = await sys.schedule.create({
    data: {
      organizationId: org,
      name: "Day",
      timezone: "UTC",
      workingDays: [1, 2, 3, 4, 5],
      startMinute: 540,
      endMinute: 1020,
      graceMinutes: 15,
    },
  });
  const actor = { id: randomUUID(), role: "OWNER", organization };
  const calculation = new AttendanceCalculation(db),
    company = new CompanyController(db);
  async function employee(label, scheduleId = schedule.id) {
    return sys.employee.create({
      data: {
        organizationId: org,
        firstName: label,
        lastName: "Test",
        email: randomUUID() + "@example.test",
        jobTitle: "Test",
        joinedAt: new Date("2026-01-01"),
        departmentId: department.id,
        scheduleId,
      },
    });
  }
  async function session(e, start, end, status = "Late") {
    return sys.attendance.create({
      data: {
        organizationId: org,
        employeeId: e.id,
        clockIn: new Date(start),
        clockOut: end ? new Date(end) : null,
        status,
      },
    });
  }
  async function summary(e, date = "2026-11-18") {
    return (await calculation.page(actor, { date, employee: e.id })).items[0];
  }
  const ontime = await employee("On time");
  await session(ontime, "2026-11-18T09:00Z", "2026-11-18T17:00Z", "Present");
  check((await summary(ontime)).status, "Present");
  const late = await employee("Late");
  await session(late, "2026-11-18T10:00Z", "2026-11-18T17:00Z");
  check((await summary(late)).status, "Late");
  const after = await employee("After shift");
  const afterSession = await session(
    after,
    "2026-11-18T21:00Z",
    "2026-11-18T22:00Z",
  );
  check((await summary(after)).status, "Late");
  check((await summary(after)).recordedMinutes, 60);
  check((await summary(after)).clockIn, "2026-11-18T21:00:00.000Z");
  await tenantContext.run({ organizationId: org }, async () => {
    let csv = "";
    const response = {
      destroyed: false,
      setHeader: () => {},
      write: (value) => {
        csv += value;
        return true;
      },
      end: () => {},
    };
    await new DashboardController(db, calculation).report(
      { actor },
      { from: "2026-11-18", to: "2026-11-18", employee: after.id },
      response,
    );
    assert.ok(csv.includes('"After shift Test"'));
    assert.ok(csv.includes('"60","Late"'));
    checks += 2;
  });
  const absent = await employee("Absent");
  check((await summary(absent)).status, "Absent");
  const beforeStart = await sys.$queryRaw(
    calculation.dataset(
      actor,
      "2026-11-18",
      { employee: absent.id },
      new Date("2026-11-18T09:10Z"),
    ),
  );
  check(beforeStart[0].status, "Not started");
  const type = await sys.leaveType.create({
    data: { organizationId: org, name: "Annual" },
  });
  const leave = await employee("On leave");
  await sys.leaveRequest.create({
    data: {
      organizationId: org,
      employeeId: leave.id,
      leaveTypeId: type.id,
      startDate: "2026-11-18",
      endDate: "2026-11-18",
      days: 1,
      reason: "Fixture",
      status: "Approved",
    },
  });
  check((await summary(leave)).status, "On Leave");
  await sys.holiday.create({
    data: {
      organizationId: org,
      date: "2026-11-19",
      name: "Configured holiday",
    },
  });
  check((await summary(absent, "2026-11-19")).status, "Holiday");
  check((await summary(absent, "2026-11-21")).status, "Rest Day");
  const overnight = await sys.schedule.create({
    data: {
      organizationId: org,
      name: "Night",
      timezone: "UTC",
      workingDays: [1, 2, 3, 4, 5],
      startMinute: 1320,
      endMinute: 360,
    },
  });
  const night = await employee("Night", overnight.id);
  await session(night, "2026-11-19T01:00Z", "2026-11-19T06:00Z");
  check((await summary(night)).recordedMinutes, 300);
  check((await summary(night)).status, "Late");
  const multi = await employee("Multiple");
  await session(multi, "2026-11-18T09:00Z", "2026-11-18T12:00Z", "Present");
  await session(multi, "2026-11-18T13:00Z", "2026-11-18T17:00Z");
  check((await summary(multi)).recordedMinutes, 420);
  check((await summary(multi)).sessionCount, 2);
  const missing = await employee("Missing out");
  await session(missing, "2026-11-18T09:00Z", null, "Present");
  check((await summary(missing)).status, "Incomplete Session");
  check((await summary(missing)).clockOut, null);
  await sys.attendance.update({
    where: { id: afterSession.id },
    data: { clockIn: new Date("2026-11-18T09:00Z"), status: "Present" },
  });
  check((await summary(after)).status, "Present");
  check((await summary(after)).recordedMinutes, 780);
  await sys.schedule.update({
    where: { id: schedule.id },
    data: { timezone: "Pacific/Auckland", startMinute: 1200, endMinute: 480 },
  });
  check((await summary(ontime)).status, "Present");
  check((await summary(ontime)).timezone, "UTC");
  await assert.rejects(
    sys.attendance.update({
      where: { id: afterSession.id },
      data: { scheduleSnapshot: { timezone: "Europe/London" } },
    }),
  );
  checks++;
  const zone = await sys.schedule.create({
    data: {
      organizationId: org,
      name: "LA",
      timezone: "America/Los_Angeles",
      workingDays: [1, 2, 3, 4, 5],
      startMinute: 540,
      endMinute: 1020,
    },
  });
  const zoned = await employee("Timezone", zone.id);
  await session(zoned, "2026-11-19T04:00Z", "2026-11-19T05:00Z");
  check((await summary(zoned)).recordedMinutes, 60);
  const totals = await calculation.counts(actor, "2026-11-18");
  check(totals.absent, 1);
  check(totals.present, 7);
  const overnightNow = await calculation.counts(
    actor,
    "2026-11-19",
    new Date("2026-11-19T02:00Z"),
    true,
  );
  check(overnightNow.present, 1);

  // More than 1,000 invitees, with a single employee's old records deliberately
  // exceeding the former arbitrary 100-row fetch cap.
  const people = Array.from({ length: 1001 }, (_, i) => ({
    id: randomUUID(),
    organizationId: org,
    firstName: "Paged" + i,
    lastName: "Test",
    email: randomUUID() + "@example.test",
    jobTitle: "Fixture",
    joinedAt: new Date("2026-01-01"),
    departmentId: department.id,
    scheduleId: schedule.id,
  }));
  await sys.employee.createMany({ data: people });
  await sys.user.create({
    data: {
      id: actor.id,
      email: randomUUID() + "@example.test",
      passwordHash: "[Unusable isolated fixture]",
    },
  });
  fixtureUsers.push(actor.id);
  await sys.employee.update({
    where: { id: people[0].id },
    data: { userId: actor.id },
  });
  await sys.membership.create({
    data: {
      organizationId: org,
      userId: actor.id,
      employeeId: people[0].id,
      role: "OWNER",
    },
  });
  await sys.attendance.createMany({
    data: Array.from({ length: 125 }, (_, i) => ({
      organizationId: org,
      employeeId: people[0].id,
      clockIn: new Date(Date.UTC(2026, 5, 1, 9, i * 2)),
      clockOut: new Date(Date.UTC(2026, 5, 1, 9, i * 2 + 1)),
      status: "Present",
    })),
  });
  await tenantContext.run({ organizationId: org }, async () => {
    const attendance = new AttendanceController(db, calculation),
      req = { actor: { ...actor, employee: people[0] } };
    for (const mine of [true, false]) {
      const ids = new Set();
      let after;
      for (let page = 1; page <= 7; page++) {
        const q = {
          date: "2026-06-01",
          page: String(page),
          ...(after ? { after } : {}),
        };
        const result = await (mine
          ? attendance.mine(req, q)
          : attendance.list(req, q));
        check(result.total, 125);
        after = result.nextCursor;
        for (const item of mine ? result.history : result.items) {
          assert.ok(!ids.has(item.id));
          ids.add(item.id);
        }
      }
      check(ids.size, 125);
    }
    await assert.rejects(
      attendance.list(req, { date: ["2026-06-01"] }),
      /valid YYYY-MM-DD/,
    );
    checks++;
    await assert.rejects(
      attendance.list(req, { department: [department.id] }),
      /Invalid department/,
    );
    checks++;
    await assert.rejects(
      attendance.list({ actor: { ...req.actor, role: "EMPLOYEE" } }, {}),
    );
    checks++;
  });
  const invites = people.map((e, i) => ({
    id: randomUUID(),
    organizationId: org,
    employeeId: e.id,
    email: e.email,
    role: "EMPLOYEE",
    tokenHash: randomUUID(),
    expiresAt: new Date("2030-01-01"),
    invitedBy: "fixture",
    createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, i)),
  }));
  await sys.invitation.createMany({ data: invites });
  await sys.invitation.createMany({
    data: Array.from({ length: 125 }, (_, i) => ({
      ...invites[0],
      id: randomUUID(),
      tokenHash: randomUUID(),
      status: "Revoked",
      createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, i)),
    })),
  });
  await tenantContext.run({ organizationId: org }, async () => {
    const first = await company.invitations(
      { actor },
      { page: "1", limit: "100" },
    );
    check(first.total, 1001);
    check(first.items.length, 100);
    await sys.invitation.update({
      where: { id: invites[0].id },
      data: { expiresAt: new Date(Date.now() + 30 * 60000) },
    });
    await sys.mailJob.create({
      data: {
        organizationId: org,
        referenceId: invites[0].id,
        to: people[0].email,
        subject: "Isolated history timestamp",
        body: "[Fixture accepted delivery]",
        status: "Accepted",
        createdAt: new Date("2026-11-18T21:44:00Z"),
        acceptedAt: new Date("2026-11-18T21:44:01Z"),
      },
    });
    const pending = await company.invitations(
      { actor },
      { search: people[0].email },
    );
    check(pending.items[0].status, "Pending");
    check(pending.items[0].delivery.createdAt, "2026-11-18T21:44:00.000Z");
    const history = await company.invitationHistory(
      { actor },
      invites[0].id,
      {},
    );
    check(history.items[0].createdAt, "2026-11-18T21:44:00.000Z");
    const ids = new Set();
    let after;
    for (let page = 1; page <= 11; page++) {
      const result = await company.invitations(
        { actor },
        { page: String(page), limit: "100", ...(after ? { after } : {}) },
      );
      after = result.nextCursor;
      for (const item of result.items) {
        assert.ok(!ids.has(item.employeeId));
        ids.add(item.employeeId);
      }
    }
    check(ids.size, 1001);
    await sys.mailJob.createMany({
      data: Array.from({ length: 125 }, (_, i) => ({
        organizationId: org,
        referenceId: invites[0].id,
        to: people[0].email,
        subject: "Isolated cursor history",
        body: "[Fixture]",
        status: "Accepted",
        createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, i)),
      })),
    });
    const historyIds = new Set();
    let historyAfter;
    for (let page = 1; page <= 7; page++) {
      const result = await company.invitationHistory({ actor }, invites[0].id, {
        page: String(page),
        ...(historyAfter ? { after: historyAfter } : {}),
      });
      check(result.total, 126);
      historyAfter = result.nextCursor;
      for (const job of result.items) {
        assert.ok(!historyIds.has(job.id));
        historyIds.add(job.id);
      }
    }
    check(historyIds.size, 126);
    await assert.rejects(company.invitations({ actor }, { after: "invalid" }));
    checks++;

    await assert.rejects(company.invitations({ actor }, { page: "0" }));
    checks++;
  });
  // Nested recruitment pagination must not inflate job responses or cross tenants.
  const position = await sys.job.create({
    data: {
      organizationId: org,
      title: "Paged position",
      department: "Test",
      description: "Fixture",
    },
  });
  await sys.candidate.createMany({
    data: Array.from({ length: 125 }, (_, i) => ({
      organizationId: org,
      jobId: position.id,
      name: "Candidate " + String(i).padStart(3, "0"),
      email: `candidate-${i}@example.test`,
      stage: i === 124 ? "Screening" : "Applied",
      createdAt: new Date("2026-01-01"),
    })),
  });
  await tenantContext.run({ organizationId: org }, async () => {
    const hr = new HrController(db),
      req = { actor };
    const jobs = await hr.recruitment(req, { search: "Paged position" });
    check(jobs.total, 1);
    check(
      (await hr.recruitment(req, { search: "  Paged position  " })).total,
      1,
    );
    check(
      (await hr.candidates(req, position.id, { search: " 124 " })).total,
      1,
    );
    check(
      (await hr.options(req, { search: " Day " })).pagination.totals.schedules,
      1,
    );
    check(jobs.items[0]._count.candidates, 125);
    check("candidates" in jobs.items[0], false);
    const ids = new Set();
    for (let page = 1; page <= 7; page++) {
      const candidates = await hr.candidates(req, position.id, {
        page: String(page),
      });
      check(candidates.total, 125);
      for (const c of candidates.items) {
        assert.ok(!ids.has(c.id));
        ids.add(c.id);
      }
    }
    check(ids.size, 125);
    check(
      (await hr.candidates(req, position.id, { stage: "Screening" })).total,
      1,
    );
    check((await hr.candidates(req, position.id, { search: "124" })).total, 1);
    await assert.rejects(hr.candidates(req, position.id, { limit: "101" }));
    checks++;
    await assert.rejects(
      hr.candidates({ actor: { ...actor, role: "EMPLOYEE" } }, position.id, {}),
    );
    checks++;
    const expectedCandidates = await sys.candidate.findMany({
      where: { jobId: position.id },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    const cursorFirst = await hr.candidates(req, position.id, {});
    await sys.candidate.delete({ where: { id: cursorFirst.items.at(-1).id } });
    await sys.candidate.create({
      data: {
        organizationId: org,
        jobId: position.id,
        name: "Concurrent newest",
        email: "concurrent@example.test",
        createdAt: new Date("2027-01-01"),
      },
    });
    const cursorSecond = await hr.candidates(req, position.id, {
      page: "2",
      after: cursorFirst.nextCursor,
    });
    check(
      cursorSecond.items.map((c) => c.id),
      expectedCandidates.slice(20, 40).map((c) => c.id),
    );
    check(cursorSecond.total, 125);
    await assert.rejects(
      hr.candidates(req, position.id, {
        search: "different",
        after: cursorFirst.nextCursor,
      }),
    );
    checks++;
    await assert.rejects(
      hr.candidates(req, position.id, { after: "not-a-cursor" }),
    );
    checks++;
    check(
      (await hr.lookup(req, "employees", { search: "Paged0 Test" })).total,
      1,
    );
    check((await hr.employees(req, { search: "Paged0 Fixture" })).total, 1);
    const departmentCursor = await hr.lookup(req, "departments", {});
    await assert.rejects(
      hr.lookup(req, "schedules", { after: departmentCursor.nextCursor }),
    );
    checks++;
    const remote = await hr.lookup(req, "employees", {
      search: "Paged",
      page: "11",
      limit: "100",
    });
    check(remote.total, 1001);
    check(remote.items.length, 1);
    await assert.rejects(hr.lookup(req, "invalid", {}));
    checks++;
    await assert.rejects(
      hr.lookup({ actor: { ...actor, role: "EMPLOYEE" } }, "employees", {}),
    );
    checks++;
    await assert.rejects(
      hr.lookup({ actor: { ...actor, role: "EMPLOYEE" } }, "jobs", {}),
    );
    checks++;
    const lookup = await hr.options(req, { page: "11", limit: "100" });
    check(lookup.pagination.totals.employees, 1010);
    check(lookup.employees.length, 10);
    check(
      (await hr.options(req, { search: "Paged" })).pagination.totals.employees,
      1001,
    );
    check(
      (await hr.options({ actor: { ...actor, role: "EMPLOYEE" } }, {}))
        .employees.length,
      0,
    );
  });
  await tenantContext.run({ organizationId: randomUUID() }, async () => {
    await assert.rejects(
      new HrController(db).candidates({ actor }, position.id, {}),
    );
    checks++;
  });
  await sys.job.createMany({
    data: Array.from({ length: 125 }, (_, i) => ({
      organizationId: org,
      title: `Bulk position ${i}`,
      department: "Test",
      description: "Isolated paged job",
    })),
  });
  await sys.department.createMany({
    data: Array.from({ length: 125 }, (_, i) => ({
      organizationId: org,
      name: `Bulk department ${i}`,
    })),
  });
  await sys.task.createMany({
    data: Array.from({ length: 125 }, (_, i) => ({
      organizationId: org,
      employeeId: people[0].id,
      title: `Bulk task ${i}`,
      dueDate: new Date("2026-12-01"),
    })),
  });
  await sys.schedule.createMany({
    data: Array.from({ length: 125 }, (_, i) => ({
      organizationId: org,
      name: `Bulk schedule ${i}`,
      timezone: "UTC",
      workingDays: [1, 2, 3, 4, 5],
      startMinute: 540,
      endMinute: 1020,
    })),
  });
  await sys.leaveType.createMany({
    data: Array.from({ length: 125 }, (_, i) => ({
      organizationId: org,
      name: `Bulk leave type ${i}`,
    })),
  });
  await sys.asset.createMany({
    data: Array.from({ length: 125 }, (_, i) => ({
      organizationId: org,
      identifier: randomUUID(),
      name: `Bulk asset ${i}`,
    })),
  });
  await sys.document.createMany({
    data: Array.from({ length: 125 }, (_, i) => ({
      organizationId: org,
      employeeId: people[0].id,
      name: `Bulk document ${i}`,
      category: "Fixture",
      storageKey: randomUUID(),
      mime: "text/plain",
      bytes: 1,
      uploadedBy: actor.id,
    })),
  });
  await sys.leaveAllocation.createMany({
    data: people.slice(0, 125).map((e) => ({
      organizationId: org,
      employeeId: e.id,
      leaveTypeId: type.id,
      year: 2027,
      days: 1,
    })),
  });
  await sys.leaveRequest.createMany({
    data: people.slice(0, 125).map((e) => ({
      organizationId: org,
      employeeId: e.id,
      leaveTypeId: type.id,
      startDate: "2027-01-04",
      endDate: "2027-01-04",
      days: 1,
      reason: "Bulk leave fixture",
    })),
  });
  await sys.payroll.createMany({
    data: people.slice(0, 125).map((e) => ({
      organizationId: org,
      employeeId: e.id,
      period: "2027-01",
      baseMinor: 100n,
      netMinor: 100n,
      createdBy: actor.id,
    })),
  });
  await sys.notification.createMany({
    data: people.slice(0, 125).map(() => ({
      organizationId: org,
      userId: actor.id,
      title: "Bulk notification",
      body: "Fixture",
    })),
  });
  await sys.audit.createMany({
    data: people.slice(0, 125).map((e) => ({
      organizationId: org,
      actorId: actor.id,
      action: "Bulk audit fixture",
      entityId: e.id,
    })),
  });
  await tenantContext.run({ organizationId: org }, async () => {
    const hr = new HrController(db),
      resources = new ResourcesController(db),
      req = { actor };
    const ownOptions = await hr.options({
      actor: { ...actor, employee: people[0] },
    });
    check(ownOptions.schedules.length, 100);
    check(ownOptions.departments.length, 100);
    check(ownOptions.current.schedule.id, schedule.id);
    check(ownOptions.current.department.id, department.id);
    check(
      ownOptions.schedules.some((item) => item.id === schedule.id),
      false,
    );
    check(
      ownOptions.departments.some((item) => item.id === department.id),
      false,
    );
    for (const load of [
      (q) => hr.departments(q),
      (q) => hr.schedules(q),
      (q) => hr.leaveTypes(q),
      (q) => hr.recruitment(req, q),
      (q) => hr.tasks(req, q),
      (q) => resources.assets(req, q),
      (q) => resources.documents(req, q),
    ]) {
      const last = await load({ search: "Bulk", page: "7" });
      check(last.total, 125);
      check(last.items.length, 5);
      const first = await load({ search: "Bulk" }),
        next = await load({
          search: "Bulk",
          page: "2",
          after: first.nextCursor,
        });
      check(
        new Set([...first.items, ...next.items].map((item) => item.id)).size,
        40,
      );
      await assert.rejects(load({ search: "x".repeat(201) }));
      checks++;
    }
    const staff = {
      actor: { ...actor, role: "EMPLOYEE", employee: { id: people[1].id } },
    };
    check((await resources.documents(staff, { search: "Bulk" })).total, 0);
    check((await resources.assets(staff, { search: "Bulk" })).total, 0);
    check((await hr.tasks(staff, { search: "Bulk" })).total, 0);
    for (const load of [
      async (q) => {
        const result = await hr.leave(
          { actor: { ...actor, employee: people[0] } },
          q,
        );
        return { ...result, items: result.requests };
      },
      (q) => hr.payroll(req, { ...q, search: "2027-01" }),
      (q) => company.notifications(req, q),
      (q) => hr.auditLogs(req, q),
    ]) {
      const ids = new Set();
      let after;
      for (let page = 1; page <= 7; page++) {
        const result = await load({
          search: "Bulk",
          page: String(page),
          ...(after ? { after } : {}),
        });
        check(result.total, 125);
        assert.ok(
          result.nextCursor,
          "Every nonempty page exposes its continuation position",
        );
        after = result.nextCursor;
        for (const item of result.items) {
          assert.ok(!ids.has(item.id));
          ids.add(item.id);
        }
      }
      check(ids.size, 125);
    }
    check((await company.notifications(staff, { search: "Bulk" })).total, 125);
    check(
      (
        await company.notifications(
          { actor: { ...staff.actor, id: "another-identity" } },
          { search: "Bulk" },
        )
      ).total,
      0,
    );
    check(
      (await hr.payroll(staff, { search: "2027-01", status: "Draft" })).total,
      0,
    );
    check((await hr.leave(staff, { search: "Bulk" })).total, 1);
    const balanceTypes = await sys.leaveType.findMany({
      where: { organizationId: org, name: { startsWith: "Bulk leave type" } },
    });
    await sys.leaveAllocation.createMany({
      data: balanceTypes.map((t) => ({
        organizationId: org,
        employeeId: people[0].id,
        leaveTypeId: t.id,
        year: 2026,
        days: 10,
      })),
    });
    await sys.leaveRequest.createMany({
      data: ["Pending", "Rejected", "Cancelled"].map((status, i) => ({
        organizationId: org,
        employeeId: people[0].id,
        leaveTypeId: balanceTypes[0].id,
        startDate: `2026-12-0${i + 1}`,
        endDate: `2026-12-0${i + 1}`,
        days: 1,
        reason: "Isolated balance calculation",
        status,
      })),
    });
    const ownReq = { actor: { ...actor, employee: people[0] } };
    const balanceIds = new Set();
    let balanceAfter;
    for (let page = 1; page <= 7; page++) {
      const result = await hr.leaveBalances(ownReq, {
        year: "2026",
        page: String(page),
        ...(balanceAfter ? { after: balanceAfter } : {}),
      });
      check(result.total, 125);
      balanceAfter = result.nextCursor;
      for (const balance of result.items) {
        assert.ok(!balanceIds.has(balance.id));
        balanceIds.add(balance.id);
        assert.equal(
          balance.remaining,
          balance.leaveTypeId === balanceTypes[0].id ? 9 : 10,
        );
      }
    }
    check(balanceIds.size, 125);
    check((await hr.leaveBalances(staff, { year: "2026" })).total, 0);
    const legacyPreview = await hr.leave(ownReq, {});
    check(legacyPreview.balances.length, 20);
    check(legacyPreview.balanceTotal, 125);
    check(
      (await hr.leave(ownReq, { includeBalances: "false" })).balanceTotal,
      null,
    );
    await assert.rejects(hr.leaveBalances(ownReq, { year: ["2026"] }));
    checks++;
    const balanceFirst = await hr.leaveBalances(ownReq, { year: "2026" });
    await assert.rejects(
      hr.leaveBalances(ownReq, {
        year: "2027",
        after: balanceFirst.nextCursor,
      }),
    );
    checks++;
    await assert.rejects(async () => hr.auditLogs(staff, {}));
    checks++;
  });
  const historyTask = await sys.task.create({
    data: {
      organizationId: org,
      employeeId: people[0].id,
      title: "Paged task history",
      dueDate: new Date("2026-12-01"),
    },
  });
  const historyAsset = await sys.asset.create({
    data: {
      organizationId: org,
      identifier: randomUUID(),
      name: "Paged asset history",
    },
  });
  await sys.taskEvent.createMany({
    data: Array.from({ length: 125 }, (_, i) => ({
      organizationId: org,
      taskId: historyTask.id,
      actorId: actor.id,
      status: "To Do",
      note: `Note ${i}`,
      createdAt: new Date("2026-01-01"),
    })),
  });
  await sys.assetHistory.createMany({
    data: Array.from({ length: 125 }, (_, i) => ({
      organizationId: org,
      assetId: historyAsset.id,
      actorId: actor.id,
      action: "Assigned",
      reason: `Reason ${i}`,
      createdAt: new Date("2026-01-01"),
    })),
  });
  await tenantContext.run({ organizationId: org }, async () => {
    const hr = new HrController(db),
      resources = new ResourcesController(db),
      req = { actor };
    for (const load of [
      (q) => hr.taskHistory(req, historyTask.id, q),
      (q) => resources.assetHistory(req, historyAsset.id, q),
    ]) {
      const ids = new Set();
      for (let page = 1; page <= 7; page++) {
        const result = await load({ page: String(page) });
        check(result.total, 125);
        for (const event of result.items) {
          assert.ok(!ids.has(event.id));
          ids.add(event.id);
        }
      }
      check(ids.size, 125);
      await assert.rejects(load({ limit: "101" }));
      checks++;
    }
    check((await hr.tasks(req, { search: "Paged task history" })).total, 1);
    check(
      (await resources.assets(req, { search: "Paged asset history" })).total,
      1,
    );
    await assert.rejects(
      resources.assetHistory(
        {
          actor: { ...actor, role: "EMPLOYEE", employee: { id: people[0].id } },
        },
        historyAsset.id,
        {},
      ),
    );
    checks++;
    const managerReq = {
      actor: { ...actor, role: "MANAGER", employee: { id: people[0].id } },
    };
    await sys.performanceReview.create({
      data: {
        organizationId: org,
        employeeId: people[0].id,
        period: "2026",
        goal: "Own review",
      },
    });
    await sys.performanceReview.create({
      data: {
        organizationId: org,
        employeeId: people[1].id,
        period: "2026",
        goal: "Other review",
      },
    });
    check((await resources.teamReviews(managerReq, {})).total, 1);
    check(
      (await resources.teamReviews(managerReq, { employeeId: people[1].id }))
        .total,
      0,
    );
  });
  await tenantContext.run({ organizationId: randomUUID() }, async () => {
    await assert.rejects(
      new HrController(db).taskHistory({ actor }, historyTask.id, {}),
    );
    checks++;
    await assert.rejects(
      new ResourcesController(db).assetHistory({ actor }, historyAsset.id, {}),
    );
    checks++;
  });
  const last = await calculation.page(actor, {
    date: "2026-11-18",
    page: "11",
    limit: "100",
  });
  check(last.total, 1010);
  check(last.items.length, 10);
  check(
    (await calculation.page(actor, { date: "2026-11-18", status: "Late" }))
      .total,
    4,
  );
  const overflow = Array.from({ length: 10001 - 1010 }, (_, i) => ({
    id: randomUUID(),
    organizationId: org,
    firstName: "Overflow" + i,
    lastName: "Test",
    email: randomUUID() + "@example.test",
    jobTitle: "Fixture",
    joinedAt: new Date("2026-01-01"),
    departmentId: department.id,
    scheduleId: schedule.id,
  }));
  for (let i = 0; i < overflow.length; i += 500)
    await sys.employee.createMany({ data: overflow.slice(i, i + 500) });
  const beyondOldCap = await calculation.page(actor, {
    date: "2026-11-18",
    page: "101",
    limit: "100",
  });
  check(beyondOldCap.total, 10001);
  check(beyondOldCap.items.length, 1);
  await tenantContext.run({ organizationId: org }, async () => {
    const exported = new Set();
    let ended = false;
    let writes = 0;
    const response = {
      destroyed: false,
      setHeader: () => {},
      write: (line) => {
        if (writes++ > 0) {
          const id = line.split(",")[1].replaceAll('"', "");
          assert.ok(!exported.has(id), "CSV must not repeat an employee");
          exported.add(id);
        }
        return true;
      },
      end: () => {
        ended = true;
      },
    };
    await new DashboardController(db, calculation).report(
      { actor },
      {
        from: "2026-11-18",
        to: "2026-11-18",
        after: "ignored-client-cursor",
        page: "999",
      },
      response,
    );
    check(exported.size, 10001);
    check(writes, 10002);
    check(ended, true);
    await assert.rejects(
      new DashboardController(db, calculation).report(
        { actor },
        { from: ["2026-11-18"], to: "2026-11-18" },
        response,
      ),
      /Choose a report range/,
    );
    checks++;
  });
  const summaryFirst = await calculation.page(actor, {
    date: "2026-11-18",
    limit: "100",
  });
  const summaryNext = await calculation.page(actor, {
    date: "2026-11-18",
    page: "2",
    limit: "100",
    after: summaryFirst.nextCursor,
  });
  const summaryOffset = await calculation.page(actor, {
    date: "2026-11-18",
    page: "2",
    limit: "100",
  });
  check(
    summaryNext.items.map((row) => row.employee.id),
    summaryOffset.items.map((row) => row.employee.id),
  );
  check(
    new Set(
      [...summaryFirst.items, ...summaryNext.items].map(
        (row) => row.employee.id,
      ),
    ).size,
    200,
  );
  await assert.rejects(
    calculation.page(actor, {
      date: "2026-11-19",
      after: summaryFirst.nextCursor,
    }),
  );
  checks++;

  await tenantContext.run({ organizationId: org }, async () => {
    const employeePage = await new HrController(db).employees(
      { actor },
      { page: "101", limit: "100" },
    );
    check(employeePage.total, 10001);
    check(employeePage.items.length, 1);
  });
  const fixtureUser = await sys.user.create({
    data: {
      email: randomUUID() + "@example.test",
      passwordHash: "[Unusable isolated fixture]",
    },
  });
  fixtureUsers.push(fixtureUser.id);
  const sessions = Array.from({ length: 125 }, () => ({
    id: randomUUID(),
    userId: fixtureUser.id,
    expiresAt: new Date(Date.now() + 86400000),
  }));
  await sys.session.createMany({
    data: [
      ...sessions,
      {
        id: randomUUID(),
        userId: fixtureUser.id,
        expiresAt: new Date(Date.now() - 86400000),
      },
    ],
  });
  const account = new AccountSecurityController(db),
    sessionActor = {
      actor: {
        id: fixtureUser.id,
        sessionId: sessions[0].id,
        platformAdmin: false,
      },
    };
  const sessionIds = new Set();
  let sessionAfter,
    currentSessions = 0;
  for (let page = 1; page <= 7; page++) {
    const result = await account.sessions(sessionActor, {
      page: String(page),
      ...(sessionAfter ? { after: sessionAfter } : {}),
    });
    check(result.total, 125);
    check(
      result.items.every((item) => item.expiresAt.getTime() > Date.now()),
      true,
    );
    sessionAfter = result.nextCursor;
    for (const item of result.items) {
      assert.ok(!sessionIds.has(item.id));
      sessionIds.add(item.id);
      if (item.current) currentSessions++;
    }
    if (page === 1)
      check(Object.keys(result.items[0]).sort(), [
        "current",
        "expiresAt",
        "id",
      ]);
  }
  check(sessionIds.size, 125);
  check(currentSessions, 1);
  const accountFirst = await account.sessions(sessionActor, {});
  await assert.rejects(
    account.sessions(
      { actor: { ...sessionActor.actor, id: randomUUID() } },
      { after: accountFirst.nextCursor },
    ),
  );
  checks++;
  const futureOrganizations = Array.from({ length: 40 }, (_, i) => ({
    id: randomUUID(),
    name: "Future fixture",
    slug: randomUUID(),
    businessEmail: "future@example.test",
    createdAt: new Date(Date.UTC(2030, 0, 1 + i)),
  }));
  await sys.organization.createMany({ data: futureOrganizations });
  organizations.push(...futureOrganizations.map((item) => item.id));
  const platformOverview = await new PlatformController(db).overview();
  check(
    platformOverview.registrations.every(
      (row) => Number.isInteger(row.count) && row.count > 0,
    ),
    true,
  );
  check(platformOverview.registrations.length <= 31, true);
  check(
    platformOverview.registrations.reduce((sum, row) => sum + row.count, 0),
    await sys.organization.count({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 30 * 86400000),
          lte: new Date(),
        },
      },
    }),
  );
  for (const [date, startMinute, graceMinutes, now, expected] of [
    ["2026-03-08", 540, 15, "2026-03-08T13:16Z", "Absent"],
    ["2026-11-01", 540, 15, "2026-11-01T14:10Z", "Not started"],
    ["2026-11-01", 90, 15, "2026-11-01T06:46Z", "Absent"],
    ["2026-03-08", 150, 15, "2026-03-08T07:46Z", "Absent"],
    ["2026-11-01", 55, 75, "2026-11-01T06:10Z", "Not started"],
    ["2026-11-01", 55, 75, "2026-11-01T06:11Z", "Absent"],
  ]) {
    const dst = await sys.schedule.create({
      data: {
        organizationId: org,
        name: randomUUID(),
        timezone: "America/New_York",
        workingDays: [1, 2, 3, 4, 5, 6, 7],
        startMinute,
        endMinute: 1020,
        graceMinutes,
      },
    });
    const person = await employee("DST fixture", dst.id);
    const [result] = await sys.$queryRaw(
      calculation.dataset(actor, date, { employee: person.id }, new Date(now)),
    );
    check(result.status, expected);
    check(
      result.status,
      dayAttendanceStatus(date, dst, [], false, false, new Date(now)),
    );
    const [wall] =
      await sys.$queryRaw`SELECT ((${date}::date + ${startMinute}*interval '1 minute') AT TIME ZONE 'America/New_York') AS instant`;
    check(
      wall.instant.toISOString(),
      shiftWindow(date, dst).start.toJSDate().toISOString(),
    );
  }
  console.log(
    `PASS: ${checks} attendance/snapshot/zone/correction, list/history/lookup/cursor and >1,000-invitation / >10,000-employee assertions; all fixture data isolated and cleaned.`,
  );
} finally {
  await cleanCompanies(sys, organizations, fixtureUsers);
  await sys.$disconnect();
}
