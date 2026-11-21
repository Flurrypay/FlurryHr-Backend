import fs from "node:fs/promises";
import { format } from "prettier";
import assert from "node:assert/strict";
const source = await fs.readFile(
  new URL("../docs/PRODUCTION_COMPLETION_CHECKLIST.md", import.meta.url),
  "utf8",
);
const states = new Set([
  "NOT_STARTED",
  "IN_PROGRESS",
  "IMPLEMENTED",
  "VERIFIED",
  "BLOCKED",
]);
const rows = source
  .split("\n")
  .map((line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((x) => x.trim()),
  )
  .filter((c) =>
    /^(ATT|LIST|OPS|PERF|AUTH|SEC|SPEC|PROSE|EXT)-\d+$/.test(c[0] || ""),
  )
  .map((c) => {
    assert.equal(c.length, 11, `Invalid column count for ${c[0]}`);
    assert.ok(c.every(Boolean), `Empty inventory cell for ${c[0]}`);
    return {
      id: c[0],
      section: c[1],
      requirement: c[2],
      status: c.length === 4 ? c[2] : c[7],
      existingImplementation: c[3],
      gap: c[4],
      priority: c[5],
      dependencies: c[6],
      coverage: c[9],
      evidence: c.at(-1),
      files: c.length === 4 ? null : c[8],
    };
  });
const ids = new Set();
for (const row of rows) {
  assert.ok(!ids.has(row.id), `Duplicate ID ${row.id}`);
  ids.add(row.id);
  assert.ok(states.has(row.status), `Invalid state ${row.id}`);
}
for (const [prefix, count] of [
  ["SPEC", 645],
  ["PROSE", 212],
  ["EXT", 6],
])
  for (let i = 1; i <= count; i++)
    assert.ok(
      ids.has(`${prefix}-${String(i).padStart(3, "0")}`),
      `Missing ${prefix}-${i}`,
    );
const directive = await fs.readFile(
  new URL("../docs/PRODUCTION_DIRECTIVE.md", import.meta.url),
  "utf8",
);
const normalize = (value) =>
  value
    .replaceAll("**", "")
    .replaceAll("`", "")
    .replaceAll("&#124;", "|")
    .trim();
const lines = directive.split("\n");
const bullets = lines.flatMap((line) => {
  const match = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
  return match ? [match[1]] : [];
});
assert.equal(
  bullets.length,
  645,
  "Original directive bullet inventory changed; reconcile without replacing original IDs",
);
for (let index = 0; index < 645; index++) {
  const id = `SPEC-${String(index + 1).padStart(3, "0")}`;
  assert.equal(
    normalize(rows.find((row) => row.id === id).requirement),
    normalize(bullets[index]),
    `Original description changed: ${id}`,
  );
}
const paragraphs = lines.filter(
  (line) => line.trim() && !/^\s*(?:#|---|[-*]\s|\d+\.\s)/.test(line),
);
let paragraphIndex = 0;
for (let index = 1; index <= 212; index++) {
  const id = `PROSE-${String(index).padStart(3, "0")}`,
    expected = normalize(rows.find((row) => row.id === id).requirement);
  const found = paragraphs.findIndex(
    (line, i) => i >= paragraphIndex && normalize(line) === expected,
  );
  assert.ok(found >= 0, `Original directive paragraph not found: ${id}`);
  paragraphIndex = found + 1;
}
const groups = Object.groupBy(rows, (r) => r.section);
const duplicates = Object.values(
  Object.groupBy(
    rows.filter((r) => !r.id.startsWith("EXT")),
    (r) => r.requirement.toLowerCase().replace(/[^a-z0-9]/g, ""),
  ),
)
  .filter((g) => g.length > 1)
  .map((g) => g.map((r) => r.id));
const statuses = Object.fromEntries(
  [...states].map((state) => [
    state,
    rows.filter((r) => r.status === state).length,
  ]),
);
function implementationStage(row) {
  const section = row.section.toLowerCase();
  if (row.id.startsWith("LIST") || /pagination|truncation/.test(section))
    return 1;
  if (row.id.startsWith("ATT") || /attendance|work schedules/.test(section))
    return 2;
  if (/company profile|department|holiday|ownership|registration/.test(section))
    return 3;
  if (/employee profile|account security|employee account/.test(section))
    return 4;
  if (
    /platform|privileged|organisation management|support|subscription/.test(
      section,
    )
  )
    return 5;
  if (/leave/.test(section)) return 6;
  if (/payroll|payslip|financial|statutory|payment/.test(section)) return 7;
  if (/recruitment|onboarding|offboarding/.test(section)) return 8;
  if (/performance management|training|tasks|report/.test(section)) return 9;
  if (/document/.test(section)) return 10;
  if (/email|notification|message/.test(section)) return 11;
  if (
    /infrastructure|deployment|monitoring|backup|configuration|background/.test(
      section,
    )
  )
    return 12;
  if (
    row.id.startsWith("PERF") ||
    /benchmark|acceptance testing|verification gates/.test(section)
  )
    return 13;
  return 14; // Cross-cutting directives remain active; never discard them.
}
const queue = rows
  .filter((row) => !["VERIFIED", "BLOCKED"].includes(row.status))
  .map((row) => ({
    id: row.id,
    stage: implementationStage(row),
    priority: row.priority,
    dependencies: row.dependencies,
  }))
  .sort(
    (a, b) =>
      a.stage - b.stage ||
      a.priority.localeCompare(b.priority) ||
      a.id.localeCompare(b.id),
  );
const inventory = {
  description:
    "All original IDs retained. Section groups are parent-child navigation, duplicate descriptions remain independent acceptance entries. Source/test reconciliation is ongoing; statuses are never inferred from another row.",
  statuses,
  sourceDescriptionsVerified: { spec: 645, prose: 212 },
  total: rows.length,
  duplicateDescriptions: duplicates,
  implementationQueue: queue,
  blockedEntries: rows
    .filter((row) => row.status === "BLOCKED")
    .map((row) => row.id),
  sectionRequirements: Object.fromEntries(
    Object.entries(groups).map(([section, items]) => [
      section,
      items.map((r) => r.id),
    ]),
  ),
  requirements: rows,
};
await fs.writeFile(
  new URL("../docs/generated/requirement-inventory.json", import.meta.url),
  await format(JSON.stringify(inventory), { parser: "json" }),
);
console.log(
  JSON.stringify({
    total: rows.length,
    statuses,
    duplicateGroups: duplicates.length,
  }),
);
