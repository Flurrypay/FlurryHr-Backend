import { tenantContext } from "./db";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { BadRequestException } from "@nestjs/common";
if (
  process.env.PAGINATION_SIGNING_KEY &&
  Buffer.byteLength(process.env.PAGINATION_SIGNING_KEY) < 32
)
  throw new Error("PAGINATION_SIGNING_KEY must contain at least 32 bytes");
const cursorKey = createHash("sha256")
  .update(
    "flurryhr-pagination-v1:" +
      (process.env.PAGINATION_SIGNING_KEY ||
        process.env.MAIL_ENCRYPTION_KEY ||
        randomBytes(32).toString("hex")),
  )
  .digest();
function encodeCursor(value: unknown) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return (
    payload +
    "." +
    createHmac("sha256", cursorKey).update(payload).digest("base64url")
  );
}
function decodeCursor(value: string) {
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) throw Error();
  const expected = createHmac("sha256", cursorKey).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (
    actual.length !== expected.length ||
    actual.toString("base64url") !== signature ||
    !timingSafeEqual(actual, expected)
  )
    throw Error();
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}
export function pagination(query: Record<string, string>, defaultLimit = 20) {
  for (const key of [
    "page",
    "limit",
    "search",
    "status",
    "department",
    "employee",
    "phase",
    "sort",
    "direction",
    "after",
  ]) {
    const value = query[key];
    if (
      value !== undefined &&
      (typeof value !== "string" ||
        value.length > (key === "after" ? 4000 : 200))
    )
      throw new BadRequestException(`Invalid ${key} query`);
  }
  const page = Number(query.page ?? 1),
    limit = Number(query.limit ?? defaultLimit);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new BadRequestException(
      "Page must be a positive integer and limit must be between 1 and 100",
    );
  if (!Number.isSafeInteger((page - 1) * limit))
    throw new BadRequestException("Page is too large");
  return { page, limit, skip: (page - 1) * limit };
}
export async function paged<T>(
  delegate: {
    fields?: { id?: { modelName?: string } };
    findMany: (args: any) => Promise<T[]>;
    count: (args: any) => PromiseLike<unknown>;
  },
  args: Record<string, any>,
  query: Record<string, string>,
) {
  const {
    searchFields = [],
    filterFields = [],
    wordSearch = false,
    ...prismaArgs
  } = args;
  args = prismaArgs;
  const conditions: Record<string, unknown>[] = [];
  if (query.search !== undefined) {
    if (typeof query.search !== "string" || query.search.length > 200)
      throw new BadRequestException(
        "Search must be text of at most 200 characters",
      );
    if (query.search.trim() && searchFields.length) {
      const matching = (value: string) => ({
        OR: searchFields.map((field: string) => ({
          [field]: { contains: value, mode: "insensitive" },
        })),
      });
      conditions.push(
        wordSearch
          ? { AND: query.search.trim().split(/\s+/).map(matching) }
          : matching(query.search.trim()),
      );
    }
  }
  for (const field of filterFields)
    if (query[field] !== undefined && query[field] !== "") {
      if (typeof query[field] !== "string" || query[field].length > 200)
        throw new BadRequestException(`Invalid ${field} filter`);
      conditions.push({ [field]: query[field] });
    }
  if (conditions.length)
    args = { ...args, where: { AND: [args.where ?? {}, ...conditions] } };
  const { page, limit, skip } = pagination(query);
  const ordering = Array.isArray(args.orderBy)
    ? args.orderBy
    : args.orderBy
      ? [args.orderBy]
      : [];
  const order = [...ordering, { id: "asc" }];
  const countWhere = args.where;
  const model =
    (delegate as typeof delegate & { fields?: { id?: { modelName?: string } } })
      .fields?.id?.modelName || "custom-list";
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        model,
        organizationId: tenantContext.getStore()?.organizationId,
        where: countWhere,
        order,
      }),
    )
    .digest("hex");
  if (query.after) {
    try {
      if (typeof query.after !== "string" || query.after.length > 4000)
        throw Error();
      const token = decodeCursor(query.after);
      if (
        token.scope !== fingerprint ||
        !Array.isArray(token.values) ||
        token.values.length !== order.length
      )
        throw Error();
      const values = token.values.map((entry: any) => {
        if (
          entry.type === "date" &&
          typeof entry.value === "string" &&
          Number.isFinite(Date.parse(entry.value))
        )
          return new Date(entry.value);
        if (
          entry.type === "string" &&
          typeof entry.value === "string" &&
          entry.value.length <= 1000
        )
          return entry.value;
        if (
          entry.type === "number" &&
          typeof entry.value === "number" &&
          Number.isFinite(entry.value)
        )
          return entry.value;
        throw Error();
      });
      const branches = order.map(
        (clause: Record<string, string>, i: number) => {
          const [field, direction] = Object.entries(clause)[0];
          if (!["asc", "desc"].includes(direction)) throw Error();
          return {
            AND: [
              ...order
                .slice(0, i)
                .map((prior: Record<string, string>, j: number) => ({
                  [Object.keys(prior)[0]]: values[j],
                })),
              { [field]: { [direction === "desc" ? "lt" : "gt"]: values[i] } },
            ],
          };
        },
      );
      args = { ...args, where: { AND: [countWhere ?? {}, { OR: branches }] } };
    } catch {
      throw new BadRequestException(
        "Invalid continuation cursor; restart the list",
      );
    }
  }
  const [items, total] = await Promise.all([
    delegate.findMany({
      ...args,
      orderBy: order,
      skip: query.after ? 0 : skip,
      take: limit,
    }),
    delegate.count({ where: countWhere }),
  ]);
  const last = items.at(-1) as Record<string, unknown> | undefined;
  const values =
    last &&
    order.map((clause: Record<string, string>) => {
      const value = last[Object.keys(clause)[0]];
      return value instanceof Date
        ? { type: "date", value: value.toISOString() }
        : { type: typeof value, value };
    });
  const nextCursor =
    values &&
    values.every(
      (v: { type: string; value: unknown }) =>
        ["date", "string", "number"].includes(v.type) && v.value !== null,
    )
      ? encodeCursor({ scope: fingerprint, values })
      : null;
  return { items, total: Number(total), page, limit, nextCursor };
}

// Raw-SQL lists use explicit scope strings and serialized scalar sort keys.
export function rawCursor(scope: string, values: string[] | undefined) {
  if (!values) return null;
  return encodeCursor({
    scope: createHash("sha256").update(scope).digest("hex"),
    values,
  });
}
export function readRawCursor(
  after: string | undefined,
  scope: string,
  length: number,
): string[] | null {
  if (!after) return null;
  try {
    if (typeof after !== "string" || after.length > 4000) throw Error();
    const token = decodeCursor(after);
    if (
      token.scope !== createHash("sha256").update(scope).digest("hex") ||
      !Array.isArray(token.values) ||
      token.values.length !== length ||
      token.values.some(
        (v: unknown) => typeof v !== "string" || v.length > 1000,
      )
    )
      throw Error();
    return token.values;
  } catch {
    throw new BadRequestException(
      "Invalid continuation cursor; restart the list",
    );
  }
}
