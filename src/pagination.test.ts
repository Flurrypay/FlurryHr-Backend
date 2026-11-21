import { test } from "node:test";
import assert from "node:assert/strict";
import { pagination, paged, rawCursor, readRawCursor } from "./pagination";
test("pagination defaults and offsets are bounded", () => {
  assert.deepEqual(pagination({}), { page: 1, limit: 20, skip: 0 });
  assert.deepEqual(pagination({ page: "51", limit: "100" }), {
    page: 51,
    limit: 100,
    skip: 5000,
  });
});
test("pagination rejects invalid and unsafe input", () => {
  for (const page of ["0", "-1", "1.5", "NaN", "Infinity", "9007199254740992"])
    assert.throws(() => pagination({ page }));
  for (const limit of ["0", "101", "1.2", "Infinity"])
    assert.throws(() => pagination({ limit }));
});
test("paged query preserves scope, overrides caps and adds a unique ordering key", async () => {
  let read: Record<string, unknown> | undefined,
    count: Record<string, unknown> | undefined;
  const result = await paged(
    {
      findMany: async (args) => {
        read = args;
        return [{ id: "row" }];
      },
      count: async (args) => {
        count = args;
        return 1001;
      },
    },
    {
      where: { organizationId: "tenant" },
      orderBy: { createdAt: "desc" },
      take: 100,
    },
    { page: "11", limit: "100" },
  );
  assert.equal(result.total, 1001);
  assert.equal(result.page, 11);
  assert.deepEqual(read, {
    where: { organizationId: "tenant" },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 100,
    skip: 1000,
  });
  assert.deepEqual(count, { where: { organizationId: "tenant" } });
});

test("list filters intersect permission scope and accept only configured fields", async () => {
  let captured: any;
  const delegate = {
    findMany: async (args: any) => {
      captured = args;
      return [];
    },
    count: async () => 0,
  };
  await paged(
    delegate,
    {
      where: { employeeId: "own", status: { in: ["Approved", "Paid"] } },
      searchFields: ["period"],
      filterFields: ["status", "employeeId"],
    },
    {
      search: " November ",
      status: "Draft",
      employeeId: "other",
      organizationId: "victim",
    },
  );
  assert.deepEqual(captured.where, {
    AND: [
      { employeeId: "own", status: { in: ["Approved", "Paid"] } },
      { OR: [{ period: { contains: "November", mode: "insensitive" } }] },
      { status: "Draft" },
      { employeeId: "other" },
    ],
  });
  assert.equal(captured.searchFields, undefined);
  assert.equal(captured.filterFields, undefined);
  for (const q of [
    { search: "x".repeat(201) },
    { search: ["a", "b"] },
    { status: { not: "Paid" } },
  ])
    await assert.rejects(
      paged(
        delegate,
        { searchFields: ["period"], filterFields: ["status"] },
        q as any,
      ),
    );
});

test("continuation tokens bind ordering and filters and reject malformed payloads", async () => {
  const delegate = {
    findMany: async () => [{ id: "one", createdAt: new Date("2026-01-01") }],
    count: async () => 1,
  };
  const first = await paged(
    delegate,
    { where: { employeeId: "own" }, orderBy: { createdAt: "desc" } },
    {},
  );
  assert.ok(first.nextCursor);
  await assert.rejects(
    paged(
      delegate,
      { where: { employeeId: "own" }, orderBy: { createdAt: "desc" } },
      { after: first.nextCursor + "x" },
    ),
  );
  await assert.rejects(
    paged(
      delegate,
      { where: { employeeId: "other" }, orderBy: { createdAt: "desc" } },
      { after: first.nextCursor! },
    ),
  );
  for (const after of [
    "bad",
    "x".repeat(4001),
    Buffer.from(JSON.stringify({ values: [] })).toString("base64url"),
  ])
    await assert.rejects(paged(delegate, {}, { after }));
});

test("raw-SQL cursors preserve sort keys and reject cross-scope, oversized and malformed values", () => {
  const cursor = rawCursor("tenant/list/filter", [
    "2026-11-21T00:00:00.000Z",
    "id",
  ]);
  assert.deepEqual(readRawCursor(cursor!, "tenant/list/filter", 2), [
    "2026-11-21T00:00:00.000Z",
    "id",
  ]);
  assert.throws(() => readRawCursor(cursor!, "other-tenant/list/filter", 2));
  assert.throws(() => readRawCursor(cursor!, "tenant/list/filter", 3));
  assert.throws(() => readRawCursor("broken", "tenant/list/filter", 2));
  assert.throws(() => pagination({ search: ["a", "b"] } as any));
});

test("cursor signatures reject modified payloads", () => {
  const cursor = rawCursor("scope", ["id"])!;
  const [payload, signature] = cursor.split(".");
  const changed = Buffer.from(
    JSON.stringify({ scope: "scope", values: ["different"] }),
  ).toString("base64url");
  assert.throws(() => readRawCursor(changed + "." + signature, "scope", 1));
  assert.throws(() =>
    readRawCursor(payload + "." + signature + "x", "scope", 1),
  );
});

test("employee word search intersects tokens across configured name fields", async () => {
  let received: any;
  await paged(
    {
      findMany: async (args) => {
        received = args;
        return [];
      },
      count: async () => 0,
    },
    {
      where: { employeeId: "scope" },
      searchFields: ["firstName", "lastName"],
      wordSearch: true,
    },
    { search: "Ada Lovelace" },
  );
  assert.equal(received.where.AND[1].AND.length, 2);
  assert.deepEqual(received.where.AND[1].AND[0].OR[0], {
    firstName: { contains: "Ada", mode: "insensitive" },
  });
  assert.equal(received.wordSearch, undefined);
});

test("a continuation cannot be replayed against a different model with identical filters", async () => {
  const delegate = {
    fields: { id: { modelName: "Department" } },
    findMany: async () => [{ id: "one", name: "First" }],
    count: async () => 1,
  };
  const first = await paged(delegate, { orderBy: { name: "asc" } }, {});
  await assert.rejects(
    paged(
      { ...delegate, fields: { id: { modelName: "Schedule" } } },
      { orderBy: { name: "asc" } },
      { after: first.nextCursor! },
    ),
  );
});
