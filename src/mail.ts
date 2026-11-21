import { obsoleteMail } from "./obsolete-mail";
import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Db } from "./db";
import { zohoConfigured, sendZohoMail } from "./zoho-mail";
export function emailLink(route: string, token: string) {
  return `${process.env.WEB_ORIGIN || "http://localhost:5173"}${route}#token=${encodeURIComponent(token)}`;
}
export function mailConfigured() {
  if (process.env.MAIL_TRANSPORT === "file")
    return process.env.NODE_ENV === "test";
  return zohoConfigured();
}
function mailKey() {
  const key = process.env.MAIL_ENCRYPTION_KEY;
  if (!key || !/^[a-f0-9]{64}$/i.test(key))
    throw new Error(
      "Configure MAIL_ENCRYPTION_KEY with 64 hexadecimal characters",
    );
  return Buffer.from(key, "hex");
}
export function encrypt(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", mailKey(), iv);
  return [
    iv.toString("hex"),
    Buffer.concat([cipher.update(value, "utf8"), cipher.final()]).toString(
      "hex",
    ),
    cipher.getAuthTag().toString("hex"),
  ].join(".");
}
export function decrypt(value: string) {
  const [iv, data, tag] = value.split(".");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    mailKey(),
    Buffer.from(iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
export function queueMail(
  tx: Prisma.TransactionClient,
  data: {
    to: string;
    subject: string;
    body: string;
    organizationId?: string;
    userId?: string;
    referenceId?: string;
  },
) {
  const queuedAt = new Date();
  return tx.mailJob.create({
    data: {
      ...data,
      body: encrypt(data.body),
      createdAt: queuedAt,
      availableAt: queuedAt,
    },
  });
}
@Injectable()
export class MailWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  constructor(@Inject(Db) private db: Db) {}
  onModuleInit() {
    this.timer = setInterval(() => void this.drain(), 5000);
    this.timer.unref();
    void this.drain();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async drain() {
    if (this.busy) return;
    this.busy = true;
    try {
      const jobs = await this.db.system.$queryRaw<
        { id: string }[]
      >`UPDATE "MailJob" SET status='Processing', "lockedAt"=(now() AT TIME ZONE 'UTC') WHERE id IN (SELECT id FROM "MailJob" WHERE (status IN ('Queued','Retry') AND "availableAt" <= (now() AT TIME ZONE 'UTC')) OR (status='Queued' AND attempts=0 AND "availableAt"="createdAt") OR (status='Processing' AND "lockedAt" < (now() AT TIME ZONE 'UTC')-interval '5 minutes') ORDER BY "createdAt" LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING id`;
      for (const { id } of jobs) {
        const job = await this.db.system.mailJob.findUniqueOrThrow({
          where: { id },
        });
        if (job.status !== "Processing") continue;
        try {
          const plaintext = decrypt(job.body);
          if (await obsoleteMail(this.db.system, job, plaintext)) {
            await this.db.system.mailJob.updateMany({
              where: { id, status: "Processing" },
              data: {
                status: "Superseded",
                body: "[Obsolete message removed]",
                lockedAt: null,
                lastError: null,
              },
            });
            continue;
          }
          if (process.env.MAIL_TRANSPORT === "file") {
            if (process.env.NODE_ENV !== "test")
              throw new Error("TEST_TRANSPORT_DISABLED");
            const dir = path.resolve(
              process.env.TEST_MAIL_DIR || ".local/test-mail",
            );
            await mkdir(dir, { recursive: true, mode: 0o700 });
            await writeFile(
              path.join(dir, `${job.id}.json`),
              JSON.stringify({
                id: job.id,
                to: job.to,
                subject: job.subject,
                body: plaintext,
              }),
              { mode: 0o600 },
            );
          } else {
            await sendZohoMail({ ...job, body: plaintext });
          }
          // Provider acceptance is not a guarantee of inbox delivery.
          await this.db.system.mailJob.update({
            where: { id },
            data: {
              status: "Accepted",
              acceptedAt: new Date(),
              attempts: { increment: 1 },
              lastError: null,
              body: "[Redacted after provider acceptance]",
            },
          });
        } catch (error) {
          const attempts = job.attempts + 1;
          const code =
            error instanceof Error &&
            [
              "MAIL_NOT_CONFIGURED",
              "ZOHO_CONFIGURATION_ERROR",
              "ZOHO_DELIVERY_REJECTED",
              "TEST_TRANSPORT_DISABLED",
            ].includes(error.message)
              ? error.message
              : "PROVIDER_DELIVERY_ERROR";
          await this.db.system.mailJob.update({
            where: { id },
            data: {
              status: attempts >= 5 ? "Failed" : "Retry",
              attempts,
              lastError: code,
              availableAt: new Date(
                Date.now() + Math.min(3600000, 30000 * 2 ** attempts),
              ),
            },
          });
          await this.db.system.platformAudit.create({
            data: {
              actorId: "mail-worker",
              action: "mail.delivery_failed",
              organizationId: job.organizationId,
              reason: code,
            },
          });
        }
      }
    } catch {
      console.error(JSON.stringify({ event: "mail.worker_error" }));
    } finally {
      this.busy = false;
    }
  }
}
