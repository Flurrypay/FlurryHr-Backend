import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
export async function obsoleteMail(
  db: PrismaClient,
  job: {
    referenceId: string | null;
    organizationId: string | null;
    userId: string | null;
    subject: string;
  },
  body: string,
  now = new Date(),
) {
  const encoded = body.match(/#token=([A-Za-z0-9_%-]+)/)?.[1];
  if (job.referenceId) {
    const invitation = await db.invitation.findFirst({
      where: {
        id: job.referenceId,
        organizationId: job.organizationId || undefined,
      },
    });
    if (invitation) {
      if (
        !encoded ||
        invitation.status !== "Pending" ||
        invitation.expiresAt <= now
      )
        return true;
      let token: string;
      try {
        token = decodeURIComponent(encoded);
      } catch {
        return true;
      }
      if (
        createHash("sha256").update(token).digest("hex") !==
        invitation.tokenHash
      )
        return true;
      const [employee, org] = await Promise.all([
        db.employee.findFirst({
          where: {
            id: invitation.employeeId,
            organizationId: invitation.organizationId,
          },
        }),
        db.organization.findUnique({
          where: { id: invitation.organizationId },
        }),
      ]);
      return (
        !employee || employee.status !== "Invited" || org?.status !== "Active"
      );
    }
    return true;
  }
  if (encoded && job.userId) {
    let token: string;
    try {
      token = decodeURIComponent(encoded);
    } catch {
      return true;
    }
    const record = await db.accountToken.findUnique({
      where: { hash: createHash("sha256").update(token).digest("hex") },
    });
    if (
      !record ||
      record.userId !== job.userId ||
      record.consumedAt ||
      record.expiresAt <= now
    )
      return true;
  }
  if (job.userId) {
    const user = await db.user.findUnique({
      where: { id: job.userId },
      select: { active: true },
    });
    if (!user?.active) return true;
  }
  if (job.organizationId && !encoded) {
    const org = await db.organization.findUnique({
      where: { id: job.organizationId },
      select: { status: true },
    });
    if (org?.status !== "Active") return true;
  }
  return false;
}
