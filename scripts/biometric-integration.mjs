import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Db, tenantContext } = require("../dist/src/db.js");
const { BiometricsController } = require("../dist/src/biometrics.js");
const { AttendanceController } = require("../dist/src/attendance.js");
const { FaceRetention } = require("../dist/src/face-retention.js");
const { HrController } = require("../dist/src/hr.js");
if (
  !/^\/flurryhr_test(?:_[a-z0-9]+)*$/i.test(
    new URL(process.env.DATABASE_URL || "postgresql://invalid/invalid")
      .pathname,
  )
)
  throw Error("Use the isolated test database");
process.env.AWS_FACE_REGION = "us-east-1";
process.env.AWS_FACE_STREAM_ROLE_ARN = "arn:aws:iam::000000000000:role/fixture";
process.env.BIOMETRIC_ENCRYPTION_KEY = "b".repeat(64);
const db = new Db(),
  orgs = [],
  users = [];
let passed = 0,
  confidence = 99,
  similarity = 99.9,
  providerFailure = false;
const provider = {
  start: async () => ({
    sessionId: randomUUID(),
    region: "us-east-1",
    credentials: {
      accessKeyId: "fixture",
      secretAccessKey: "fixture",
      sessionToken: "fixture",
      expiration: new Date(Date.now() + 180000).toISOString(),
    },
  }),
  result: async () => {
    if (providerFailure) throw Error("fixture-provider-outage");
    return {
      passed: true,
      confidence,
      image: Buffer.from("fake-reference-fixture; never a real biometric"),
    };
  },
  compare: async () => similarity,
};
const controller = new BiometricsController(db, provider),
  attendance = new AttendanceController(db, null);
const location = {
  address: "Fixture approved Lagos office",
  latitude: 6.5244,
  longitude: 3.3792,
};
const gps = () => ({
  latitude: location.latitude,
  longitude: location.longitude,
  accuracy: 5,
  capturedAt: Date.now(),
});
async function organization() {
  const org = await db.system.organization.create({
    data: {
      name: "Biometric fixture",
      slug: randomUUID(),
      businessEmail: `${randomUUID()}@example.test`,
      status: "Active",
      attendanceLocation: location,
      onboardingCompleted: true,
    },
  });
  orgs.push(org.id);
  const department = await db.system.department.create({
      data: { organizationId: org.id, name: "Fixture" },
    }),
    schedule = await db.system.schedule.create({
      data: { organizationId: org.id, name: "Fixture" },
    });
  return { org, department, schedule };
}
async function actor(company, role = "EMPLOYEE") {
  const user = await db.system.user.create({
    data: {
      email: `${randomUUID()}@example.test`,
      passwordHash: "not-a-real-login",
      emailVerifiedAt: new Date(),
    },
  });
  users.push(user.id);
  const employee = await db.system.employee.create({
    data: {
      organizationId: company.org.id,
      userId: user.id,
      email: user.email,
      firstName: "Fixture",
      lastName: role,
      jobTitle: "Fixture",
      departmentId: company.department.id,
      scheduleId: company.schedule.id,
      joinedAt: new Date("2020-01-01"),
      workArrangement: "Hybrid",
    },
  });
  return {
    actor: {
      ...user,
      organization: company.org,
      employee,
      role,
      sessionId: randomUUID(),
    },
    header: () => undefined,
  };
}
const scoped = (req, fn) =>
  tenantContext.run({ organizationId: req.actor.organization.id }, fn);
async function reject(req, fn, pattern) {
  await assert.rejects(scoped(req, fn), pattern);
  passed++;
}
async function check(req, fn) {
  const result = await scoped(req, fn);
  passed++;
  return result;
}
async function start(req, purpose = "Enrollment", attendanceId) {
  return check(req, () =>
    controller.start(req, {
      purpose,
      consent: true,
      ...(purpose !== "Enrollment" ? { position: gps() } : {}),
      attendanceId,
    }),
  );
}
async function complete(req, s) {
  return check(req, () => controller.complete(req, s.id));
}
try {
  const a = await organization(),
    b = await organization(),
    owner = await actor(a, "OWNER"),
    staff = await actor(a),
    other = await actor(b, "OWNER");
  assert.equal(
    (await check(staff, () => controller.mine(staff))).required,
    false,
  );
  await reject(
    staff,
    () => controller.setPolicy(staff, { required: true }),
    /permission/,
  );
  const configured = process.env.AWS_FACE_STREAM_ROLE_ARN;
  delete process.env.AWS_FACE_STREAM_ROLE_ARN;
  await reject(
    owner,
    () => controller.setPolicy(owner, { required: true }),
    /Configure AWS/,
  );
  process.env.AWS_FACE_STREAM_ROLE_ARN = configured;
  await check(owner, () => controller.setPolicy(owner, { required: true }));
  await reject(
    staff,
    () => attendance.clockIn(staff, gps()),
    /fresh face verification/,
  );
  await reject(
    staff,
    () =>
      controller.start(staff, {
        purpose: "ClockIn",
        consent: true,
        position: gps(),
      }),
    /HR approval/,
  );
  const enrollmentSession = await start(staff);
  await reject(other, () => controller.complete(other, enrollmentSession.id));
  await complete(staff, enrollmentSession);
  const e = (await check(staff, () => controller.mine(staff))).enrollment;
  assert.equal(e.status, "Pending");
  const stored = await db.system.faceEnrollment.findUniqueOrThrow({
    where: { id: e.id },
  });
  assert.ok(!stored.referenceEncrypted.includes("fake-reference"));
  assert.equal("referenceEncrypted" in e, false);
  await reject(
    staff,
    () =>
      controller.review(staff, e.id, {
        status: "Approved",
        reason: "Fixture approval",
      }),
    /permission/,
  );
  await reject(
    owner,
    () =>
      controller.review(owner, e.id, {
        status: "Approved",
        reason: "Fixture approval",
      }),
    /View and verify/,
  );
  await reject(other, () =>
    controller.image(other, e.id, { setHeader() {}, send() {} }),
  );
  await check(owner, () =>
    controller.image(owner, e.id, {
      setHeader() {},
      send(bytes) {
        assert.ok(bytes.length);
      },
    }),
  );
  await check(owner, () =>
    controller.review(owner, e.id, {
      status: "Approved",
      reason: "Verified with trusted HR identity record",
    }),
  );
  await reject(
    staff,
    () => controller.start(staff, { purpose: "Enrollment", consent: true }),
    /already approved/,
  );
  await reject(
    staff,
    () =>
      controller.start(staff, {
        purpose: "ClockIn",
        consent: true,
        position: { ...gps(), latitude: 7 },
      }),
    /within 100/,
  );
  const live = await start(staff, "ClockIn");
  const differentSession = {
    ...staff,
    actor: { ...staff.actor, sessionId: randomUUID() },
  };
  await reject(differentSession, () =>
    controller.complete(differentSession, live.id),
  );
  await complete(staff, live);
  await reject(
    differentSession,
    () =>
      attendance.clockIn(differentSession, { ...gps(), faceCheckId: live.id }),
    /expired/,
  );
  await reject(
    staff,
    () => attendance.clockIn(staff, { ...gps(), faceCheckId: randomUUID() }),
    /expired/,
  );
  const session = await check(staff, () =>
    attendance.clockIn(staff, { ...gps(), faceCheckId: live.id }),
  );
  assert.equal(session.locationVerification.faceClockIn.checkId, live.id);
  assert.equal(
    (await db.system.faceCheck.findUniqueOrThrow({ where: { id: live.id } }))
      .status,
    "Consumed",
  );
  // Replay returns the existing session, without another attendance mutation.
  assert.equal(
    (
      await check(staff, () =>
        attendance.clockIn(staff, { ...gps(), faceCheckId: live.id }),
      )
    ).id,
    session.id,
  );
  await reject(
    staff,
    () =>
      attendance.clockOut(staff, session.id, {
        ...gps(),
        faceCheckId: live.id,
      }),
    /expired/,
  );
  const out = await start(staff, "ClockOut", session.id);
  await complete(staff, out);
  const closed = await check(staff, () =>
    attendance.clockOut(staff, session.id, { ...gps(), faceCheckId: out.id }),
  );
  assert.ok(closed.clockOut);
  assert.equal(closed.locationVerification.faceClockOut.checkId, out.id);
  const expired = await start(staff, "ClockIn");
  await complete(staff, expired);
  await db.system.faceCheck.update({
    where: { id: expired.id },
    data: { expiresAt: new Date(Date.now() - 1) },
  });
  await reject(
    staff,
    () => attendance.clockIn(staff, { ...gps(), faceCheckId: expired.id }),
    /expired/,
  );
  confidence = 12;
  const spoof = await start(staff, "ClockIn");
  await reject(staff, () => controller.complete(staff, spoof.id), /Liveness/);
  confidence = 99;
  similarity = 20;
  const mismatch = await start(staff, "ClockIn");
  await reject(
    staff,
    () => controller.complete(staff, mismatch.id),
    /Face comparison/,
  );
  similarity = 99.9;
  providerFailure = true;
  const outage = await start(staff, "ClockIn");
  await reject(
    staff,
    () => controller.complete(staff, outage.id),
    /fixture-provider-outage/,
  );
  providerFailure = false;
  const stale = await start(staff, "ClockIn");
  await complete(staff, stale);
  await check(owner, () =>
    controller.reset(owner, staff.actor.employee.id, {
      reason: "Fixture HR requested new enrollment",
    }),
  );
  assert.equal(
    (await db.system.faceEnrollment.findUniqueOrThrow({ where: { id: e.id } }))
      .referenceEncrypted,
    null,
  );
  await reject(
    staff,
    () => attendance.clockIn(staff, { ...gps(), faceCheckId: stale.id }),
    /HR must approve/,
  );
  const second = await start(staff);
  await complete(staff, second);
  await check(staff, () => controller.withdraw(staff));
  assert.equal(
    (await db.system.faceEnrollment.findUniqueOrThrow({ where: { id: e.id } }))
      .referenceEncrypted,
    null,
  );
  const reenrollment = await start(staff);
  await complete(staff, reenrollment);
  await check(owner, () =>
    controller.image(owner, e.id, { setHeader() {}, send() {} }),
  );
  await check(owner, () =>
    controller.review(owner, e.id, {
      status: "Approved",
      reason: "Verified replacement using HR identity record",
    }),
  );
  const offboardProof = await start(staff, "ClockIn");
  await complete(staff, offboardProof);
  await check(owner, () =>
    new HrController(db).employeeStatus(owner, staff.actor.employee.id, {
      status: "Inactive",
      reason: "Fixture approved offboarding",
    }),
  );
  assert.equal(
    (await db.system.faceEnrollment.findUniqueOrThrow({ where: { id: e.id } }))
      .referenceEncrypted,
    null,
  );
  assert.equal(
    (
      await db.system.faceCheck.findUniqueOrThrow({
        where: { id: offboardProof.id },
      })
    ).status,
    "Superseded",
  );
  const ownerEnrollment = await start(owner);
  await complete(owner, ownerEnrollment);
  const oe = (await check(owner, () => controller.mine(owner))).enrollment;
  await reject(
    owner,
    () =>
      controller.review(owner, oe.id, {
        status: "Approved",
        reason: "Self approval should fail",
      }),
    /Another HR/,
  );
  await db.system.faceEnrollment.update({
    where: { id: oe.id },
    data: { consentAt: new Date(Date.now() - 8 * 86400000) },
  });
  await new FaceRetention(db).purge();
  assert.equal(
    (await db.system.faceEnrollment.findUniqueOrThrow({ where: { id: oe.id } }))
      .referenceEncrypted,
    null,
  );
  assert.equal(
    await db.system.attendance.count({
      where: { employeeId: staff.actor.employee.id },
    }),
    1,
  );
  const reviewAudit = await db.system.audit.count({
    where: { organizationId: a.org.id, action: { startsWith: "biometric." } },
  });
  assert.ok(reviewAudit > 10);
  console.log(
    `PASS: ${passed} biometric controller/database checks; location+face attendance, no proof replay, tenant and actor binding, HR-only approval, self-approval denial, provider/liveness/match failures, reset/withdrawal, retention and audit. Provider mocked; no AWS calls or real biometric data.`,
  );
} finally {
  await db.system.$transaction(async (tx) => {
    await tx.faceCheck.deleteMany({ where: { organizationId: { in: orgs } } });
    await tx.faceEnrollment.deleteMany({
      where: { organizationId: { in: orgs } },
    });
    await tx.audit.deleteMany({ where: { organizationId: { in: orgs } } });
    await tx.attendance.deleteMany({ where: { organizationId: { in: orgs } } });
    await tx.onboardingItem.deleteMany({
      where: { organizationId: { in: orgs } },
    });
    await tx.employee.deleteMany({ where: { organizationId: { in: orgs } } });
    await tx.department.deleteMany({ where: { organizationId: { in: orgs } } });
    await tx.schedule.deleteMany({ where: { organizationId: { in: orgs } } });
    await tx.organization.deleteMany({ where: { id: { in: orgs } } });
    await tx.user.deleteMany({ where: { id: { in: users } } });
  });
  await db.system.$disconnect();
}
