import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { consumeAttendanceFace } from "./biometrics";
import { protectFace, revealFace, faceThresholds } from "./face-provider";
const actor = {
  id: "user",
  sessionId: "auth-session",
  organization: { id: "org" },
  employee: { id: "employee" },
} as Parameters<typeof consumeAttendanceFace>[1];
function fixture(
  overrides: {
    required?: boolean;
    enrollment?: unknown;
    check?: unknown;
    count?: number;
  } = {},
) {
  const calls: unknown[] = [];
  const tx = {
    organization: {
      findUniqueOrThrow: async () => ({
        biometricAttendanceRequired: overrides.required ?? true,
      }),
    },
    faceEnrollment: {
      findUnique: async () =>
        overrides.enrollment === undefined
          ? { status: "Approved", version: 2, referenceEncrypted: "encrypted" }
          : overrides.enrollment,
    },
    faceCheck: {
      findFirst: async (args: unknown) => {
        calls.push(args);
        return overrides.check === undefined
          ? {
              id: "proof",
              enrollmentVersion: 2,
              liveness: 99,
              similarity: 99.9,
              verifiedAt: new Date(),
            }
          : overrides.check;
      },
      updateMany: async (args: unknown) => {
        calls.push(args);
        return { count: overrides.count ?? 1 };
      },
    },
  };
  return {
    tx: tx as unknown as Parameters<typeof consumeAttendanceFace>[0],
    calls,
  };
}
test("required attendance refuses absent, expired or consumed proof", async () => {
  await assert.rejects(
    consumeAttendanceFace(fixture().tx, actor, "ClockIn", undefined),
    /fresh face verification/,
  );
  await assert.rejects(
    consumeAttendanceFace(
      fixture({ check: null }).tx,
      actor,
      "ClockIn",
      "proof",
    ),
    /expired/,
  );
  await assert.rejects(
    consumeAttendanceFace(fixture({ count: 0 }).tx, actor, "ClockIn", "proof"),
    /already used/,
  );
});
test("face proofs bind tenant, user, employee, purpose, session and current approved enrollment version", async () => {
  const f = fixture();
  await consumeAttendanceFace(f.tx, actor, "ClockOut", "proof", "session");
  const where = (f.calls[0] as { where: Record<string, unknown> }).where;
  assert.equal(where.organizationId, "org");
  assert.equal(where.userId, "user");
  assert.equal(where.authSessionId, "auth-session");
  assert.equal(where.employeeId, "employee");
  assert.equal(where.purpose, "ClockOut");
  assert.equal(where.targetAttendanceId, "session");
  assert.equal(where.enrollmentVersion, 2);
  assert.equal(where.status, "Verified");
  assert.ok((where.expiresAt as { gt: Date }).gt instanceof Date);
});
test("pending, erased and revoked enrollment cannot authorize attendance", async () => {
  for (const enrollment of [
    null,
    { status: "Pending", version: 2, referenceEncrypted: "ref" },
    { status: "Revoked", version: 3, referenceEncrypted: null },
    { status: "Approved", version: 3, referenceEncrypted: null },
  ])
    await assert.rejects(
      consumeAttendanceFace(
        fixture({ enrollment }).tx,
        actor,
        "ClockIn",
        "proof",
      ),
      /HR must approve/,
    );
});
test("disabled policy preserves location-only rollout; proof use is conditional and returns minimal receipt", async () => {
  assert.equal(
    await consumeAttendanceFace(
      fixture({ required: false }).tx,
      actor,
      "ClockIn",
      undefined,
    ),
    null,
  );
  const f = fixture();
  const r = await consumeAttendanceFace(f.tx, actor, "ClockIn", "proof");
  assert.equal(r?.checkId, "proof");
  assert.equal("referenceEncrypted" in r!, false);
  assert.equal(
    (f.calls[1] as { where: { status: string } }).where.status,
    "Verified",
  );
});
test("reference encryption is randomized and bound to tenant, employee and enrollment version", () => {
  const old = process.env.BIOMETRIC_ENCRYPTION_KEY;
  process.env.BIOMETRIC_ENCRYPTION_KEY = "a".repeat(64);
  try {
    const a = protectFace("fixture-reference", "org|employee|1"),
      b = protectFace("fixture-reference", "org|employee|1");
    assert.notEqual(a, b);
    assert.equal(revealFace(a, "org|employee|1"), "fixture-reference");
    assert.throws(() => revealFace(a, "other-org|employee|1"));
    assert.throws(() => revealFace(a, "org|employee|2"));
  } finally {
    if (old === undefined) delete process.env.BIOMETRIC_ENCRYPTION_KEY;
    else process.env.BIOMETRIC_ENCRYPTION_KEY = old;
  }
});
test("threshold configuration rejects non-finite or unsafe reductions", () => {
  const old = process.env.FACE_MATCH_THRESHOLD;
  try {
    for (const value of ["NaN", "1", "98", "101"]) {
      process.env.FACE_MATCH_THRESHOLD = value;
      assert.throws(faceThresholds);
    }
    process.env.FACE_MATCH_THRESHOLD = "99";
    assert.equal(faceThresholds().similarity, 99);
  } finally {
    if (old === undefined) delete process.env.FACE_MATCH_THRESHOLD;
    else process.env.FACE_MATCH_THRESHOLD = old;
  }
});
