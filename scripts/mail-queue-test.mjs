import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
const require = createRequire(import.meta.url),
  { Db } = require("../dist/src/db.js"),
  { MailWorker, queueMail, encrypt } = require("../dist/src/mail.js");
if (
  process.env.NODE_ENV !== "test" ||
  process.env.MAIL_TRANSPORT !== "file" ||
  !/^\/flurryhr_test(?:_[a-z0-9]+)*$/i.test(
    new URL(process.env.DATABASE_URL || "postgresql://invalid/invalid")
      .pathname,
  )
)
  throw Error("File-only isolated mail environment required");
const db = new Db(),
  sys = db.system,
  worker = new MailWorker(db),
  ids = [],
  temp = await fs.mkdtemp("/tmp/flurryhr-mail-regression-"),
  started = new Date();
process.env.TEST_MAIL_DIR = temp;
const data = {
  to: "isolated-queue@example.test",
  subject: "Isolated queue regression",
  body: "Fixture message, no external delivery",
};
try {
  const delayed = await sys.mailJob.create({
    data: {
      ...data,
      body: encrypt(data.body),
      status: "Retry",
      attempts: 1,
      createdAt: new Date(),
      availableAt: new Date(Date.now() + 60000),
    },
  });
  ids.push(delayed.id);
  const immediate = await sys.$transaction((tx) => queueMail(tx, data));
  ids.push(immediate.id);
  const legacyDate = new Date(Date.now() + 3600000),
    legacy = await sys.mailJob.create({
      data: {
        ...data,
        body: encrypt(data.body),
        createdAt: legacyDate,
        availableAt: legacyDate,
      },
    });
  ids.push(legacy.id);
  const obsolete = await sys.mailJob.create({
    data: {
      ...data,
      referenceId: randomUUID(),
      body: encrypt("https://example.test/accept-invitation#token=removed"),
    },
  });
  ids.push(obsolete.id);
  await worker.drain();
  const pending = await sys.mailJob.findUniqueOrThrow({
    where: { id: delayed.id },
  });
  assert.equal(pending.status, "Retry");
  assert.equal(pending.attempts, 1);
  for (const job of [immediate, legacy]) {
    const sent = await sys.mailJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(sent.status, "Accepted");
    assert.ok(
      Math.abs(Date.now() - sent.lockedAt.getTime()) < 5000,
      "Lease must use UTC independently of database timezone",
    );
    assert.ok(await fs.stat(path.join(temp, job.id + ".json")));
  }
  assert.equal(
    (await sys.mailJob.findUniqueOrThrow({ where: { id: obsolete.id } }))
      .status,
    "Superseded",
  );
  await assert.rejects(fs.stat(path.join(temp, obsolete.id + ".json")));
  const blocked = path.join(temp, "not-a-directory");
  await fs.writeFile(blocked, "fixture");
  process.env.TEST_MAIL_DIR = blocked;
  const failed = await sys.$transaction((tx) => queueMail(tx, data));
  ids.push(failed.id);
  await worker.drain();
  const retry = await sys.mailJob.findUniqueOrThrow({
    where: { id: failed.id },
  });
  assert.equal(retry.status, "Retry");
  assert.equal(retry.attempts, 1);
  assert.ok(retry.availableAt.getTime() - Date.now() > 55000);
  await worker.drain();
  assert.equal(
    (await sys.mailJob.findUniqueOrThrow({ where: { id: failed.id } }))
      .attempts,
    1,
    "Future retry must not run early on a non-UTC server",
  );
  console.log(
    "PASS: UTC queue eligibility/leases/backoff, immediate legacy queue handling, obsolete-link cancellation and file-only provider acceptance. No external email sent.",
  );
} finally {
  await sys.mailJob.deleteMany({ where: { id: { in: ids } } });
  await sys.platformAudit.deleteMany({
    where: {
      actorId: "mail-worker",
      organizationId: null,
      createdAt: { gte: started },
    },
  });
  await sys.$disconnect();
  await fs.rm(temp, { recursive: true, force: true });
}
