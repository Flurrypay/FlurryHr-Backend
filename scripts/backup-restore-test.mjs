import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const source = new URL(
    process.env.RESTORE_TEST_SOURCE_URL || "postgresql://invalid/invalid",
  ),
  target = new URL(
    process.env.RESTORE_TEST_TARGET_URL || "postgresql://invalid/invalid",
  );
if (
  !/^\/flurryhr_migration_test(?:_[a-z0-9]+)*$/i.test(source.pathname) ||
  !/^\/flurryhr_restore_test(?:_[a-z0-9]+)*$/i.test(target.pathname) ||
  !["localhost", "127.0.0.1"].includes(source.hostname) ||
  !["localhost", "127.0.0.1"].includes(target.hostname)
)
  throw Error(
    "Restore tests require isolated local migration/restore fixture database names",
  );
const src = new PrismaClient({ datasourceUrl: source.href }),
  dst = new PrismaClient({ datasourceUrl: target.href }),
  temp = await fs.mkdtemp("/tmp/flurryhr-restore-");
const binary =
  process.platform === "darwin" ? "/opt/homebrew/opt/postgresql@16/bin/" : "";
function env(url) {
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.slice(1),
  };
}
async function signatures(db) {
  const result = {};
  for (const model of [
    "user",
    "session",
    "organization",
    "membership",
    "department",
    "schedule",
    "employee",
    "attendance",
    "payroll",
  ]) {
    const rows = await db[model].findMany({ orderBy: { id: "asc" } });
    result[model] = {
      count: rows.length,
      digest: createHash("sha256")
        .update(
          JSON.stringify(rows, (_, v) =>
            typeof v === "bigint" ? v.toString() : v,
          ),
        )
        .digest("hex"),
    };
  }
  return result;
}
try {
  const tables =
    await dst.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public'`;
  assert.equal(tables.length, 0, "Restore target must be empty");
  const before = await signatures(src);
  assert.ok(
    before.employee.count > 0,
    "Source must contain migration-preservation fixtures",
  );
  const file = path.join(temp, "fixture.dump");
  const dump = spawnSync(
    binary + "pg_dump",
    ["--format=custom", "--file", file],
    { env: env(source), encoding: "utf8" },
  );
  assert.equal(dump.status, 0, "Fixture dump failed");
  await fs.chmod(file, 0o600);
  const restore = spawnSync(
    binary + "pg_restore",
    [
      "--dbname",
      target.pathname.slice(1),
      "--no-owner",
      "--exit-on-error",
      file,
    ],
    { env: env(target), encoding: "utf8" },
  );
  assert.equal(restore.status, 0, "Fixture restoration failed");
  const after = await signatures(dst);
  assert.deepEqual(after, before, "Restored fixture signatures differ");
  const migrations =
    await dst.$queryRaw`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
  assert.equal(migrations[0].count, 8);
  console.log(
    "PASS: custom-format backup restored into an empty isolated database; identity/session/organization/membership/employee/attendance/payroll signatures and all eight migrations match. No working or production database was restored.",
  );
} finally {
  await src.$disconnect();
  await dst.$disconnect();
  await fs.rm(temp, { recursive: true, force: true });
}
