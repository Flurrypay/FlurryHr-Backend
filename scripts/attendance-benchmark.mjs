import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import fs from "node:fs/promises";
import os from "node:os";
import { cleanCompanies } from "./test-support.mjs";
const require = createRequire(import.meta.url),
  { Db } = require("../dist/src/db.js"),
  { AttendanceCalculation } = require("../dist/src/attendance-calculation.js");
if (
  !/^\/flurryhr_test(?:_[a-z0-9]+)*$/i.test(
    new URL(process.env.DATABASE_URL || "postgresql://invalid/invalid")
      .pathname,
  )
)
  throw Error("Isolated test database required");
const db = new Db(),
  sys = db.system,
  orgs = [],
  results = [];
const quantile = (values, p) =>
  values.toSorted((a, b) => a - b)[
    Math.min(values.length - 1, Math.ceil(values.length * p) - 1)
  ];
async function measure(run, n) {
  const times = [],
    cpu = process.cpuUsage();
  for (let i = 0; i < n; i++) {
    const start = performance.now();
    try {
      await run();
    } finally {
      times.push(performance.now() - start);
    }
  }
  const usage = process.cpuUsage(cpu);
  return {
    samples: n,
    p50Ms: quantile(times, 0.5),
    p95Ms: quantile(times, 0.95),
    p99Ms: quantile(times, 0.99),
    errorRate: 0,
    clientCpuMs: (usage.user + usage.system) / 1000,
    clientRssBytes: process.memoryUsage().rss,
    throughputPerSecond: n / (times.reduce((a, b) => a + b, 0) / 1000),
  };
}
try {
  const organization = await sys.organization.create({
    data: {
      name: "Isolated benchmark",
      slug: "bench-" + randomUUID(),
      businessEmail: "bench@example.test",
      status: "Active",
    },
  });
  orgs.push(organization.id);
  const org = organization.id,
    department = await sys.department.create({
      data: { organizationId: org, name: "Benchmark" },
    }),
    schedule = await sys.schedule.create({
      data: { organizationId: org, name: "Day", timezone: "UTC" },
    });
  const actor = { role: "OWNER", organization },
    calculation = new AttendanceCalculation(db);
  let previous = 0;
  for (const size of [10, 100, 500, 1000, 5000, 10000]) {
    const batch = Array.from({ length: size - previous }, (_, i) => ({
      id: randomUUID(),
      organizationId: org,
      firstName: String(previous + i).padStart(6, "0"),
      lastName: "Benchmark",
      email: randomUUID() + "@example.test",
      jobTitle: "Fixture",
      joinedAt: new Date("2026-01-01"),
      departmentId: department.id,
      scheduleId: schedule.id,
    }));
    for (let i = 0; i < batch.length; i += 500)
      await sys.employee.createMany({ data: batch.slice(i, i + 500) });
    for (let i = 0; i < batch.length; i += 500)
      await sys.attendance.createMany({
        data: batch.slice(i, i + 500).map((e) => ({
          organizationId: org,
          employeeId: e.id,
          clockIn: new Date("2026-11-18T21:00Z"),
          clockOut: new Date("2026-11-18T22:00Z"),
          status: "Late",
        })),
      });
    previous = size;
    await sys.$executeRawUnsafe('ANALYZE "Employee"');
    await sys.$executeRawUnsafe('ANALYZE "Attendance"');
    // Reproduction of the former endpoint's read-all/filter-in-JS approach, not a
    // second production implementation. It intentionally retains the old false-absence boundary.
    const baseline = async () => {
      const employees = await sys.employee.findMany({
        where: { organizationId: org },
        include: { schedule: true, department: true },
        take: 10000,
      });
      const records = await sys.attendance.findMany({
        where: {
          organizationId: org,
          clockIn: { gte: new Date("2026-11-17"), lte: new Date("2026-11-20") },
        },
      });
      return employees
        .map((e) =>
          records.filter(
            (r) =>
              r.employeeId === e.id &&
              r.clockIn <= new Date("2026-11-18T17:00Z"),
          ),
        )
        .slice(0, 20);
    };
    const optimized = () => calculation.page(actor, { date: "2026-11-18" });
    await baseline();
    const firstPage = await optimized();
    assert.equal(firstPage.total, size);
    assert.equal(firstPage.items.length, Math.min(20, size));
    assert.ok(firstPage.items.every((row) => row.status === "Late"));
    const lastPage = await calculation.page(actor, {
      date: "2026-11-18",
      page: String(Math.ceil(size / 100)),
      limit: "100",
    });
    assert.equal(lastPage.total, size);
    assert.equal(lastPage.items.length, size % 100 || 100);
    assert.ok(lastPage.items.every((row) => row.status === "Late"));
    const before = await measure(baseline, 5),
      after = await measure(optimized, 20);
    results.push({ employees: size, baseline: before, optimized: after });
    console.log(
      JSON.stringify({
        employees: size,
        beforeP95: before.p95Ms,
        afterP95: after.p95Ms,
      }),
    );
  }
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: os.platform(),
    architecture: os.arch(),
    cpu: os.cpus()[0]?.model,
    memoryBytes: os.totalmem(),
    postgres:
      "16, local isolated cluster; one process, sequential query workloads",
    scope:
      "Attendance summary only. Client RSS/CPU are not API-server or database resource metrics. Five baseline samples and twenty optimized samples; quantiles are sample order statistics, not a production SLO or concurrent load test. Fixtures are not production records.",
    results,
  };
  await fs.mkdir("docs/benchmarks", { recursive: true });
  await fs.writeFile(
    "docs/benchmarks/attendance-summary.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    "PASS: measured attendance baseline/optimized workloads; unrelated concurrent product load and other module benchmarks remain unverified.",
  );
} finally {
  await cleanCompanies(sys, orgs);
  await sys.$disconnect();
}
