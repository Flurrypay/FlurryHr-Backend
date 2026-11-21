import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: npm run mail:diagnose-reset -- user@example.com");
  process.exit(1);
}
const db = new PrismaClient({ log: [] });
try {
  // Read only. Never select mail bodies, password hashes, credentials or token hashes.
  const [user, employees, jobs] = await Promise.all([
    db.user.findUnique({ where: { email }, select: { active: true } }),
    db.employee.findMany({
      where: { email },
      take: 20,
      select: { status: true, userId: true },
    }),
    db.mailJob.findMany({
      where: { to: email, subject: "Reset your FlurryPay HR password" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        status: true,
        attempts: true,
        lastError: true,
        createdAt: true,
        availableAt: true,
        acceptedAt: true,
      },
    }),
  ]);
  const safeErrors = new Set([
    "MAIL_NOT_CONFIGURED",
    "ZOHO_CONFIGURATION_ERROR",
    "ZOHO_DELIVERY_REJECTED",
    "TEST_TRANSPORT_DISABLED",
    "PROVIDER_DELIVERY_ERROR",
  ]);
  const diagnosis = !user
    ? employees.some((e) => e.status === "Invited" && !e.userId)
      ? "INVITATION_NOT_ACCEPTED: accept the invitation to create a login account; ask HR to resend if the link expired."
      : "NO_LOGIN_ACCOUNT: verify the login email or complete invitation acceptance."
    : !user.active
      ? "ACCOUNT_INACTIVE: password reset does not reactivate an account; an authorized administrator must review it."
      : !jobs.length
        ? "NO_RESET_JOB: confirm the request reached this backend and this database; inspect backend request/errors."
        : "Review the latest reset jobs below. Accepted means Zoho accepted the message, not confirmed inbox delivery. Retry/Failed indicates sending failed; Queued/Processing may indicate a stopped or unhealthy worker; Superseded means a newer request or consumed/expired token invalidated that job.";
  console.log(
    JSON.stringify(
      {
        accountExists: !!user,
        accountActive: user?.active ?? null,
        employees: employees.map((e) => ({
          status: e.status,
          hasLogin: !!e.userId,
        })),
        diagnosis,
        resetMail: jobs.map((j) => ({
          ...j,
          lastError: j.lastError
            ? safeErrors.has(j.lastError)
              ? j.lastError
              : "REDACTED_UNRECOGNIZED_ERROR"
            : null,
        })),
      },
      null,
      2,
    ),
  );
} catch {
  console.error(
    "Diagnostic could not read the configured database. Run it in the deployed backend directory with its environment loaded. No credentials or connection details were printed.",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
