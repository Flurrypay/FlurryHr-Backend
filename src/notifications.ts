import { Prisma } from "@prisma/client";
import { queueMail } from "./mail";
export async function notifyUsers(
  tx: Prisma.TransactionClient,
  organizationId: string,
  userIds: string[],
  title: string,
  body: string,
) {
  const organization = await tx.organization.findUniqueOrThrow({
    where: { id: organizationId },
  });
  const members = await tx.membership.findMany({
    where: {
      organizationId,
      userId: { in: [...new Set(userIds)] },
      active: true,
    },
    include: { user: true },
  });
  for (const member of members) {
    await tx.notification.create({
      data: { organizationId, userId: member.userId, title, body },
    });
    // Message contains only the event summary; private records stay behind sign-in.
    if (organization.emailNotifications && member.emailNotifications)
      await queueMail(tx, {
        organizationId,
        userId: member.userId,
        to: member.user.email,
        subject: `FlurryPay HR: ${title}`,
        body: `${body}\n\nSign in to review: ${process.env.WEB_ORIGIN || "http://localhost:5173"}/workspace`,
      });
  }
}
export async function notifyEmployee(
  tx: Prisma.TransactionClient,
  organizationId: string,
  employeeId: string,
  title: string,
  body: string,
) {
  const employee = await tx.employee.findFirst({
    where: { id: employeeId, organizationId },
    select: { userId: true },
  });
  if (employee?.userId)
    await notifyUsers(tx, organizationId, [employee.userId], title, body);
}
export async function notifyReviewers(
  tx: Prisma.TransactionClient,
  organizationId: string,
  employeeId: string,
  title: string,
  body: string,
) {
  const employee = await tx.employee.findFirst({
    where: { id: employeeId, organizationId },
    include: { manager: true },
  });
  const admins = await tx.membership.findMany({
    where: {
      organizationId,
      active: true,
      role: { in: ["OWNER", "COMPANY_ADMIN", "SUPER_ADMIN", "HR_ADMIN"] },
    },
  });
  await notifyUsers(
    tx,
    organizationId,
    [
      ...admins.map((m) => m.userId),
      ...(employee?.manager?.userId ? [employee.manager.userId] : []),
    ].filter((id) => id !== employee?.userId),
    title,
    body,
  );
}
