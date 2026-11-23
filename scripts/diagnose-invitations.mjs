import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error(
    "Usage: npm run mail:diagnose-invitations -- employee@example.com",
  );
  process.exit(1);
}
const db = new PrismaClient({ log: [] });
try {
  const invitations = await db.invitation.findMany({
    where: { email },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, status: true, createdAt: true, expiresAt: true },
  });
  const jobs = await db.mailJob.findMany({
    where: { to: email, referenceId: { in: invitations.map((i) => i.id) } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      status: true,
      attempts: true,
      createdAt: true,
      acceptedAt: true,
      providerRequestId: true,
      lastError: true,
    },
  });
  const safeErrors = new Set([
    "MAIL_NOT_CONFIGURED",
    "ZOHO_CONFIGURATION_ERROR",
    "ZOHO_DELIVERY_REJECTED",
    "TEST_TRANSPORT_DISABLED",
    "PROVIDER_DELIVERY_ERROR",
  ]);
  console.log(
    JSON.stringify(
      {
        invitations,
        mail: jobs.map((job) => ({
          ...job,
          lastError:
            job.lastError &&
            (safeErrors.has(job.lastError)
              ? job.lastError
              : "PROVIDER_DELIVERY_ERROR"),
        })),
        nextStep: jobs.some((j) => j.status === "Accepted")
          ? "Provider accepted the request. Search Zoho processed email logs using providerRequestId or client_reference (mail job id) and recipient. Check delivered/bounced/suppressed status and recipient server reason. Provider acceptance does not confirm delivery."
          : "Check queued/failed job status and backend mail configuration.",
      },
      null,
      2,
    ),
  );
} finally {
  await db.$disconnect();
}
