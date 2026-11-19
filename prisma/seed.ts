import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
const db = new PrismaClient();
const organizationId = "00000000-0000-4000-8000-000000000001";
async function seed() {
  const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase(),
    password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12)
    throw new Error(
      "Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (at least 12 characters)",
    );
  await db.$transaction(async (tx) => {
    await tx.organization.upsert({
      where: { id: organizationId },
      update: {},
      create: {
        id: organizationId,
        name: "FlurryPay",
        slug: "flurrypay",
        businessEmail: email,
        status: "Active",
        onboardingCompleted: true,
        onboardingStep: 6,
      },
    });
    const schedule = await tx.schedule.upsert({
      where: {
        organizationId_name: { organizationId, name: "Standard work week" },
      },
      update: {},
      create: {
        organizationId,
        name: "Standard work week",
        timezone: process.env.COMPANY_TIMEZONE || "Africa/Lagos",
      },
    });
    const department = await tx.department.upsert({
      where: {
        organizationId_name: { organizationId, name: "People & Operations" },
      },
      update: {},
      create: { organizationId, name: "People & Operations" },
    });
    const user = await tx.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        passwordHash: await hash(password, 12),
        emailVerifiedAt: new Date(),
      },
    });
    const employee = await tx.employee.upsert({
      where: { organizationId_email: { organizationId, email } },
      update: {},
      create: {
        organizationId,
        firstName: "Workspace",
        lastName: "Administrator",
        email,
        jobTitle: "Administrator",
        joinedAt: new Date(),
        departmentId: department.id,
        scheduleId: schedule.id,
        userId: user.id,
      },
    });
    await tx.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId } },
      update: {},
      create: {
        userId: user.id,
        organizationId,
        employeeId: employee.id,
        role: "OWNER",
      },
    });
    for (const name of ["Annual leave", "Sick leave", "Unpaid leave"])
      await tx.leaveType.upsert({
        where: { organizationId_name: { organizationId, name } },
        update: {},
        create: { organizationId, name },
      });
  });
  console.log(
    "Legacy company administrator and configurable defaults are ready. Platform administrator access is provisioned separately.",
  );
}
seed().finally(() => db.$disconnect());
