import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const url = process.env.MIGRATION_TEST_DATABASE_URL;
if (
  !new URL(url || "postgresql://invalid/invalid").pathname.startsWith(
    "/flurryhr_migration_test",
  )
)
  throw new Error(
    "Set MIGRATION_TEST_DATABASE_URL to the isolated flurryhr_migration_test database",
  );
const db = new PrismaClient({ datasourceUrl: url }),
  root = process.cwd(),
  temp = await fs.mkdtemp("/tmp/flurryhr-migration-");
const run = (args) => {
  const result = spawnSync(path.join(root, "node_modules/.bin/prisma"), args, {
    cwd: root,
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
};
try {
  const existing =
    await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public'`;
  assert.equal(existing.length, 0, "Migration test database must start empty");
  await fs.mkdir(path.join(temp, "migrations/202611170001_initial"), {
    recursive: true,
  });
  await fs.copyFile("prisma/schema.prisma", path.join(temp, "schema.prisma"));
  await fs.copyFile(
    "prisma/migrations/migration_lock.toml",
    path.join(temp, "migrations/migration_lock.toml"),
  );
  await fs.copyFile(
    "prisma/migrations/202611170001_initial/migration.sql",
    path.join(temp, "migrations/202611170001_initial/migration.sql"),
  );
  run(["migrate", "deploy", "--schema", path.join(temp, "schema.prisma")]);
  const uid = randomUUID(),
    eid = randomUUID(),
    did = randomUUID(),
    sid = randomUUID(),
    attendanceId = randomUUID(),
    payrollId = randomUUID(),
    sessionId = randomUUID();
  const passwordHash = await hash("Legacy-Preserved-Password!", 4),
    clockIn = new Date("2026-11-17T22:00:00Z"),
    clockOut = new Date("2026-11-18T06:00:00Z");
  await db.$executeRaw`INSERT INTO "User" (id,email,"passwordHash",role) VALUES (${uid},'legacy-migration@example.test',${passwordHash},'SUPER_ADMIN'::"Role")`;
  await db.$executeRaw`INSERT INTO "Department" (id,name) VALUES (${did},'Legacy department')`;
  await db.$executeRaw`INSERT INTO "Schedule" (id,name) VALUES (${sid},'Legacy overnight schedule')`;
  await db.$executeRaw`INSERT INTO "Employee" (id,"firstName","lastName",email,"jobTitle","joinedAt","departmentId","scheduleId","userId") VALUES (${eid},'Legacy','Employee','legacy-migration@example.test','Test role',${new Date("2026-01-01")},${did},${sid},${uid})`;
  await db.$executeRaw`INSERT INTO "Attendance" (id,"employeeId","clockIn","clockOut") VALUES (${attendanceId},${eid},${clockIn},${clockOut})`;
  await db.$executeRaw`INSERT INTO "Payroll" (id,"employeeId",period,"baseMinor","netMinor","createdBy") VALUES (${payrollId},${eid},'2026-11',100000,100000,${uid})`;
  await db.$executeRaw`INSERT INTO "Session" (id,"userId","expiresAt") VALUES (${sessionId},${uid},${new Date(Date.now() + 3600000)})`;
  const before = (
    await db.$queryRaw`SELECT "clockIn", "clockOut" FROM "Attendance" WHERE id=${attendanceId}`
  )[0];
  run(["migrate", "deploy"]);
  run(["migrate", "deploy"]);
  const employee = await db.employee.findUniqueOrThrow({ where: { id: eid } }),
    user = await db.user.findUniqueOrThrow({ where: { id: uid } }),
    membership = await db.membership.findUniqueOrThrow({
      where: {
        userId_organizationId: {
          userId: uid,
          organizationId: employee.organizationId,
        },
      },
    }),
    attendance = await db.attendance.findUniqueOrThrow({
      where: { id: attendanceId },
    }),
    payroll = await db.payroll.findUniqueOrThrow({ where: { id: payrollId } }),
    session = await db.session.findUniqueOrThrow({ where: { id: sessionId } });
  assert.equal(employee.organizationId, "00000000-0000-4000-8000-000000000001");
  assert.equal(employee.userId, uid);
  assert.equal(user.passwordHash, passwordHash);
  assert.ok(user.emailVerifiedAt);
  assert.equal(user.platformAdmin, false);
  assert.equal(membership.role, "SUPER_ADMIN");
  assert.equal(membership.employeeId, eid);
  assert.equal(session.membershipId, membership.id);
  assert.equal(
    (
      await db.organization.findUniqueOrThrow({
        where: { id: employee.organizationId },
      })
    ).biometricAttendanceRequired,
    false,
  );
  assert.equal(await db.faceEnrollment.count(), 0);
  assert.equal(await db.faceCheck.count(), 0);
  assert.equal(employee.remoteWorkLocation, null);
  assert.equal(attendance.locationVerification, null);
  assert.equal(attendance.snapshotSource, "Legacy inferred at migration");
  assert.ok(attendance.workDate);
  assert.equal(attendance.scheduleSnapshot.timezone, "Africa/Lagos");
  assert.equal(attendance.clockIn.toISOString(), before.clockIn.toISOString());
  assert.equal(
    attendance.clockOut.toISOString(),
    before.clockOut.toISOString(),
  );
  assert.equal(payroll.netMinor, 100000n);
  assert.equal(await db.employee.count(), 1);
  const placeholders = [];
  for (const state of ["Revoked", "Deleted", "Pending"]) {
    const placeholder = await db.employee.create({
      data: {
        organizationId: employee.organizationId,
        firstName: "Placeholder",
        lastName: state,
        email: `${state.toLowerCase()}-${randomUUID()}@example.test`,
        jobTitle: "Unaccepted employee",
        departmentId: employee.departmentId,
        scheduleId: employee.scheduleId,
        joinedAt: new Date(),
        status: "Invited",
      },
    });
    await db.invitation.create({
      data: {
        organizationId: employee.organizationId,
        employeeId: placeholder.id,
        email: placeholder.email,
        role: "EMPLOYEE",
        invitedBy: uid,
        status: state,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    placeholders.push(placeholder);
  }
  // An established employee/account must not be removed by invitation cleanup.
  await db.invitation.create({
    data: {
      organizationId: employee.organizationId,
      employeeId: employee.id,
      email: employee.email,
      role: "EMPLOYEE",
      invitedBy: uid,
      status: "Deleted",
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  const repair = await fs.readFile(
    "prisma/migrations/202611210003_invitation_employee_status/migration.sql",
    "utf8",
  );
  await db.$executeRawUnsafe(repair);
  await db.$executeRawUnsafe(repair);
  assert.deepEqual(
    await Promise.all(
      placeholders.map(
        async (e) =>
          (await db.employee.findUniqueOrThrow({ where: { id: e.id } })).status,
      ),
    ),
    ["Not invited", "Removed", "Invited"],
  );
  assert.equal(
    (await db.employee.findUniqueOrThrow({ where: { id: employee.id } }))
      .status,
    employee.status,
  );
  console.log(
    "PASS: legacy invitation repair is idempotent; revoked/deleted placeholders corrected, pending invitations and established accounts preserved",
  );
  console.log(
    "PASS: initial-schema fixtures survive additive SaaS migration; identities/password hashes, employee IDs, departments, schedules, overnight attendance, payroll minor units, permissions and existing sessions preserved; legacy administrators do not gain platform privileges; repeated migrate deploy is idempotent.",
  );
} finally {
  await db.$disconnect();
  await fs.rm(temp, { recursive: true, force: true });
}
