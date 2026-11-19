import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
const db = new PrismaClient();
try {
  const email = process.env.PLATFORM_ADMIN_EMAIL?.toLowerCase(),
    password = process.env.PLATFORM_ADMIN_PASSWORD;
  if (!email || !password || password.length < 16)
    throw new Error(
      "Configure PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD (at least 16 characters) locally.",
    );
  const existing = await db.user.findUnique({ where: { email } });
  if (existing && !existing.platformAdmin)
    throw new Error(
      "This identity is a company account. Use a dedicated platform administrator email.",
    );
  if (!existing)
    await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash: await hash(password, 12),
          emailVerifiedAt: new Date(),
          platformAdmin: true,
        },
      });
      await tx.platformAudit.create({
        data: {
          actorId: "provisioning-cli",
          action: "platform.admin_provisioned",
          reason: user.id,
        },
      });
    });
  console.log(
    "Dedicated platform administrator is provisioned. No company membership or private employee access was granted.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
