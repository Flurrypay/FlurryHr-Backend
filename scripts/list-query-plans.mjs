import assert from "node:assert/strict";
import { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { cleanCompanies } from "./test-support.mjs";
if (
  !/^\/flurryhr_test(?:_[a-z0-9]+)*$/i.test(
    new URL(process.env.DATABASE_URL || "postgresql://invalid/invalid")
      .pathname,
  )
)
  throw Error("Isolated test database required");
const db = new PrismaClient(),
  organizations = [],
  results = [];
const size = 10000;
async function batches(model, data) {
  for (let i = 0; i < data.length; i += 500)
    await db[model].createMany({ data: data.slice(i, i + 500) });
}
function nodes(node) {
  return [node, ...(node.Plans || []).flatMap(nodes)];
}
try {
  const org = await db.organization.create({
    data: {
      name: "Isolated list plans",
      slug: randomUUID(),
      businessEmail: "list-plans@example.test",
      status: "Active",
    },
  });
  organizations.push(org.id);
  const department = await db.department.create({
    data: { organizationId: org.id, name: "Fixture" },
  });
  const schedule = await db.schedule.create({
    data: { organizationId: org.id, name: "Fixture" },
  });
  const job = await db.job.create({
    data: {
      organizationId: org.id,
      title: "Fixture",
      description: "Fixture",
      department: "Fixture",
    },
  });
  const employees = Array.from({ length: size }, (_, i) => ({
    id: randomUUID(),
    organizationId: org.id,
    firstName: String(i).padStart(6, "0"),
    lastName: "Fixture",
    email: randomUUID() + "@example.test",
    jobTitle: "Fixture",
    departmentId: department.id,
    scheduleId: schedule.id,
    joinedAt: new Date("2026-01-01"),
  }));
  await batches("employee", employees);
  const task = await db.task.create({
    data: {
      organizationId: org.id,
      employeeId: employees[0].id,
      title: "Fixture",
      dueDate: new Date("2026-12-01"),
    },
  });
  const asset = await db.asset.create({
    data: { organizationId: org.id, identifier: randomUUID(), name: "Fixture" },
  });
  const at = new Date("2026-11-01");
  await batches(
    "candidate",
    employees.map((e, i) => ({
      organizationId: org.id,
      jobId: job.id,
      name: "Candidate " + i,
      email: e.email,
      createdAt: at,
    })),
  );
  await batches(
    "taskEvent",
    employees.map(() => ({
      organizationId: org.id,
      taskId: task.id,
      actorId: "fixture",
      status: "Pending",
      note: "Fixture",
      createdAt: at,
    })),
  );
  await batches(
    "assetHistory",
    employees.map(() => ({
      organizationId: org.id,
      assetId: asset.id,
      actorId: "fixture",
      action: "Inspected",
      reason: "Fixture",
      createdAt: at,
    })),
  );
  for (const table of ["Candidate", "TaskEvent", "AssetHistory", "Employee"])
    await db.$executeRawUnsafe(`ANALYZE "${table}"`);
  for (const [name, index, query] of [
    [
      "candidate",
      "Candidate_parent_page_idx",
      Prisma.sql`SELECT * FROM "Candidate" WHERE "organizationId"=${org.id} AND "jobId"=${job.id} ORDER BY "createdAt" DESC,id ASC LIMIT 20`,
    ],
    [
      "task-history",
      "TaskEvent_parent_page_idx",
      Prisma.sql`SELECT * FROM "TaskEvent" WHERE "organizationId"=${org.id} AND "taskId"=${task.id} ORDER BY "createdAt" ASC,id ASC LIMIT 20`,
    ],
    [
      "asset-history",
      "AssetHistory_parent_page_idx",
      Prisma.sql`SELECT * FROM "AssetHistory" WHERE "organizationId"=${org.id} AND "assetId"=${asset.id} ORDER BY "createdAt" DESC,id ASC LIMIT 20`,
    ],
    [
      "employee-lookup",
      "Employee_name_page_idx",
      Prisma.sql`SELECT id,"firstName","lastName" FROM "Employee" WHERE "organizationId"=${org.id} ORDER BY "firstName" ASC,id ASC LIMIT 50`,
    ],
  ]) {
    const [row] = await db.$queryRaw(
      Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`,
    );
    const explanation = row["QUERY PLAN"][0];
    const tree = nodes(explanation.Plan);
    assert.ok(
      tree.some((node) => node["Index Name"] === index),
      `${name}: expected naturally selected index ${index}`,
    );
    assert.ok(
      !tree.some((node) => node["Node Type"].includes("Sort")),
      `${name}: page order must not require sorting all parent rows`,
    );
    results.push({
      name,
      fixtureRows: size,
      index,
      executionMs: explanation["Execution Time"],
      plan: explanation.Plan,
    });
  }
  await fs.mkdir("docs/generated", { recursive: true });
  await fs.writeFile(
    "docs/generated/list-query-plans.json",
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        note: "Isolated PostgreSQL query-plan evidence for first pages; not a concurrent load benchmark or indexed substring-search guarantee",
        results,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "PASS: four 10,000-row list queries naturally use their tenant/parent/order indexes without a sort; plans recorded. No concurrent capacity claim.",
  );
} finally {
  await cleanCompanies(db, organizations);
  await db.$disconnect();
}
