import fs from "node:fs/promises";
import path from "node:path";
export async function testMailToken(
  email,
  subject,
  mailDir = process.env.TEST_MAIL_DIR || "/tmp/flurryhr-saas-mail",
) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    for (const file of await fs.readdir(mailDir).catch(() => [])) {
      const mail = JSON.parse(
        await fs.readFile(path.join(mailDir, file), "utf8"),
      );
      if (mail.to === email.toLowerCase() && mail.subject.includes(subject)) {
        const token = mail.body.match(/#token=([A-Za-z0-9_%]+)/)?.[1];
        if (token) return decodeURIComponent(token);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No isolated test message accepted for ${email}: ${subject}`);
}
export async function cleanCompanies(db, organizationIds, extraUsers = []) {
  const users = [...extraUsers];
  for (const organizationId of organizationIds) {
    const memberships = await db.membership.findMany({
      where: { organizationId },
    });
    users.push(...memberships.map((m) => m.userId));
    const documents = await db.document.findMany({ where: { organizationId } });
    for (const document of documents)
      await fs
        .unlink(
          path.join(
            process.env.DOCUMENT_STORAGE_DIR || "/tmp/flurryhr-saas-documents",
            document.storageKey,
          ),
        )
        .catch(() => {});
    await db.session.deleteMany({
      where: { membershipId: { in: memberships.map((m) => m.id) } },
    });
    for (const model of [
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
      await db[model].deleteMany({ where: { organizationId } });
    await db.membership.deleteMany({ where: { organizationId } });
    await db.employee.updateMany({
      where: { organizationId },
      data: { managerId: null },
    });
    await db.employee.deleteMany({ where: { organizationId } });
    for (const model of [
      "holiday",
      "leaveType",
      "department",
      "schedule",
      "audit",
    ])
      await db[model].deleteMany({ where: { organizationId } });
    await db.mailJob.deleteMany({ where: { organizationId } });
    await db.platformAudit.deleteMany({ where: { organizationId } });
    await db.organization.delete({ where: { id: organizationId } });
  }
  const removable = await db.user.findMany({
      where: { id: { in: [...new Set(users)] }, memberships: { none: {} } },
    }),
    ids = removable.map((u) => u.id);
  await db.mailJob.deleteMany({ where: { userId: { in: ids } } });
  await db.platformAudit.deleteMany({ where: { actorId: { in: ids } } });
  await db.session.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}
