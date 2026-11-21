import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { obsoleteMail } from "./obsolete-mail";
const token = "secure-fixture-token",
  hash = createHash("sha256").update(token).digest("hex");
const job = {
  referenceId: "invitation",
  organizationId: "organization",
  userId: null,
  subject: "Invite",
};
const body = `Accept: https://example.test/accept-invitation#token=${token}`;
function fixture(overrides: Record<string, unknown> = {}) {
  return {
    invitation: {
      findFirst: async () => ({
        status: "Pending",
        expiresAt: new Date("2030-01-01"),
        tokenHash: hash,
        organizationId: "organization",
        employeeId: "employee",
        ...overrides,
      }),
    },
    employee: { findFirst: async () => ({ status: "Invited" }) },
    organization: { findUnique: async () => ({ status: "Active" }) },
  } as unknown as PrismaClient;
}
test("current invitation email can be dispatched", async () => {
  assert.equal(await obsoleteMail(fixture(), job, body), false);
});
test("revoked, deleted, expired and rotated invitation messages are obsolete", async () => {
  for (const change of [
    { status: "Revoked" },
    { status: "Deleted" },
    { status: "Accepted" },
    { expiresAt: new Date("2000-01-01") },
    { tokenHash: "rotated" },
  ])
    assert.equal(await obsoleteMail(fixture(change), job, body), true);
});
test("removed employee prevents invitation dispatch", async () => {
  const db = fixture();
  db.employee.findFirst = (async () => null) as typeof db.employee.findFirst;
  assert.equal(await obsoleteMail(db, job, body), true);
});
test("consumed password reset cannot be dispatched", async () => {
  const db = {
    accountToken: {
      findUnique: async () => ({
        userId: "user",
        consumedAt: new Date(),
        expiresAt: new Date("2030-01-01"),
      }),
    },
  } as unknown as PrismaClient;
  assert.equal(
    await obsoleteMail(db, { ...job, referenceId: null, userId: "user" }, body),
    true,
  );
});
