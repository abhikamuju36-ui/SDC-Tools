import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHoursWhere, rollupByDepartment, narrowFiltersForGroupValue, parseHoursGroupByList } from "../src/lib/hours-filters";

// hours-filters.ts is the I/O-free half of the Hours tab's query layer (hours-explorer.ts
// does the actual Prisma calls) — same split as undefined-hours-rules.ts / sections.ts,
// and for the same reason: these are the two places a filter or a rollup could silently
// disagree with what the table and the summary strip both show, so they get a test that
// doesn't need a database.

test("empty filters put no constraint on the query", () => {
  assert.deepEqual(buildHoursWhere({}), {});
});

test("jobIds filters through the job relation", () => {
  const where = buildHoursWhere({ jobIds: ["1148", "1150"] });
  assert.deepEqual(where.job, { jobId: { in: ["1148", "1150"] } });
});

test("sections filters directly on the section column", () => {
  const where = buildHoursWhere({ sections: ["10-211", "10-312"] });
  assert.deepEqual(where.section, { in: ["10-211", "10-312"] });
});

test("employeeIds alone filters employeeId", () => {
  const where = buildHoursWhere({ employeeIds: ["100605"] });
  assert.deepEqual(where.employeeId, { in: ["100605"] });
});

test("departments alone filters employeeId through the resolved employee list", () => {
  const where = buildHoursWhere({ departments: ["Mechanical Engineering"] }, ["100605", "100108"]);
  assert.deepEqual(where.employeeId, { in: ["100605", "100108"] });
});

test("a department that resolves to nobody matches nothing, not everybody", () => {
  const where = buildHoursWhere({ departments: ["Astrology"] }, []);
  assert.deepEqual(where.employeeId, { in: [] });
});

test("employee AND department together intersect rather than each independently widening the match", () => {
  const where = buildHoursWhere(
    { employeeIds: ["100605", "999999"], departments: ["Mechanical Engineering"] },
    ["100605", "100108"], // department resolves to these two
  );
  // Only 100605 is in both the explicit employee pick and the department's employee list.
  assert.deepEqual(where.employeeId, { in: ["100605"] });
});

test("date range sets both bounds, inclusive of the whole `to` day", () => {
  const where = buildHoursWhere({ from: "2026-07-01", to: "2026-07-31" });
  const workDate = where.workDate as { gte: Date; lte: Date };
  assert.equal(workDate.gte.toISOString(), "2026-07-01T00:00:00.000Z");
  assert.equal(workDate.lte.toISOString(), "2026-07-31T23:59:59.999Z");
});

test("a one-sided date range only sets the bound that was given", () => {
  const fromOnly = buildHoursWhere({ from: "2026-07-01" });
  assert.deepEqual(fromOnly.workDate, { gte: new Date("2026-07-01T00:00:00.000Z") });
  const toOnly = buildHoursWhere({ to: "2026-07-31" });
  assert.deepEqual(toOnly.workDate, { lte: new Date("2026-07-31T23:59:59.999Z") });
});

test("a malformed date string is ignored rather than reaching Prisma as an Invalid Date", () => {
  const where = buildHoursWhere({ from: "not-a-date" });
  assert.equal(where.workDate, undefined);
});

test("every dimension combines with AND — job, section and date range all apply at once", () => {
  const where = buildHoursWhere({ jobIds: ["1148"], sections: ["10-211"], from: "2026-07-01" });
  assert.deepEqual(where.job, { jobId: { in: ["1148"] } });
  assert.deepEqual(where.section, { in: ["10-211"] });
  assert.ok(where.workDate);
});

// ── months (a group-by-tree "month" node's own filter dimension) ────────────

test("months filters directly on the month column", () => {
  const where = buildHoursWhere({ months: ["2026-07"] });
  assert.deepEqual(where.month, { in: ["2026-07"] });
});

test("months and a partial from/to range apply TOGETHER, neither clobbers the other", () => {
  // Regression test: narrowing a "month" group-by node must AND with whatever from/to
  // range the parent already had, never widen/replace it — otherwise a child node's
  // total could include days its parent's own query never counted.
  const where = buildHoursWhere({ months: ["2026-07"], from: "2026-07-15", to: "2026-07-31" });
  assert.deepEqual(where.month, { in: ["2026-07"] });
  assert.ok(where.workDate);
  const workDate = where.workDate as { gte: Date; lte: Date };
  assert.equal(workDate.gte.toISOString(), "2026-07-15T00:00:00.000Z");
  assert.equal(workDate.lte.toISOString(), "2026-07-31T23:59:59.999Z");
});

// ── narrowFiltersForGroupValue ───────────────────────────────────────────────

test("narrows job by setting jobIds to exactly the one value", () => {
  assert.deepEqual(narrowFiltersForGroupValue({}, "job", "1148").jobIds, ["1148"]);
});

test("narrows employee by setting employeeIds to exactly the one value", () => {
  assert.deepEqual(narrowFiltersForGroupValue({}, "employee", "100605").employeeIds, ["100605"]);
});

test("narrows section by setting sections to exactly the one value", () => {
  assert.deepEqual(narrowFiltersForGroupValue({}, "section", "10-211").sections, ["10-211"]);
});

test("narrows department by setting departments to exactly the one value", () => {
  assert.deepEqual(narrowFiltersForGroupValue({}, "department", "Mechanical Engineering").departments, ["Mechanical Engineering"]);
});

test("narrows month by setting months, not by widening from/to", () => {
  const narrowed = narrowFiltersForGroupValue({}, "month", "2026-07");
  assert.deepEqual(narrowed.months, ["2026-07"]);
  assert.equal(narrowed.from, undefined);
  assert.equal(narrowed.to, undefined);
});

test("narrows date by pinning both from and to to the same single day", () => {
  const narrowed = narrowFiltersForGroupValue({}, "date", "2026-07-15");
  assert.equal(narrowed.from, "2026-07-15");
  assert.equal(narrowed.to, "2026-07-15");
});

test("chaining two narrowings accumulates both rather than dropping the first", () => {
  const step1 = narrowFiltersForGroupValue({ sections: ["10-211"] }, "job", "1148");
  const step2 = narrowFiltersForGroupValue(step1, "employee", "100605");
  assert.deepEqual(step2.sections, ["10-211"]);
  assert.deepEqual(step2.jobIds, ["1148"]);
  assert.deepEqual(step2.employeeIds, ["100605"]);
});

test("narrowing the same dimension twice replaces rather than unions", () => {
  const step1 = narrowFiltersForGroupValue({}, "job", "1148");
  const step2 = narrowFiltersForGroupValue(step1, "job", "1150");
  assert.deepEqual(step2.jobIds, ["1150"]);
});

// ── parseHoursGroupByList ─────────────────────────────────────────────────────

test("parses a comma-joined groupBy param, preserving order", () => {
  assert.deepEqual(parseHoursGroupByList("job,employee,section"), ["job", "employee", "section"]);
});

test("a bookmarked single-value groupBy (pre-multi-level) still parses to a one-item list", () => {
  assert.deepEqual(parseHoursGroupByList("job"), ["job"]);
});

test("undefined or empty groupBy parses to an empty list", () => {
  assert.deepEqual(parseHoursGroupByList(undefined), []);
  assert.deepEqual(parseHoursGroupByList(""), []);
});

test("an unknown dimension is dropped, not the whole list", () => {
  assert.deepEqual(parseHoursGroupByList("job,bogus,employee"), ["job", "employee"]);
});

test("a repeated dimension is de-duped, keeping its first position", () => {
  assert.deepEqual(parseHoursGroupByList("job,employee,job"), ["job", "employee"]);
});

// ── rollupByDepartment ───────────────────────────────────────────────────────

test("rolls several employees into one department bucket", () => {
  const byEmployee = [
    { employeeId: "e1", hours: 10, punchCount: 3 },
    { employeeId: "e2", hours: 5, punchCount: 2 },
    { employeeId: "e3", hours: 8, punchCount: 1 },
  ];
  const deptById = new Map([
    ["e1", "Mechanical Engineering"],
    ["e2", "Mechanical Engineering"],
    ["e3", "Controls Engineering"],
  ]);
  const g = rollupByDepartment(byEmployee, deptById);
  const me = g.find((x) => x.key === "Mechanical Engineering")!;
  assert.equal(me.hours, 15);
  assert.equal(me.punchCount, 5);
  const ce = g.find((x) => x.key === "Controls Engineering")!;
  assert.equal(ce.hours, 8);
});

test("an employee with no department mapping lands under the em dash, not dropped", () => {
  const byEmployee = [{ employeeId: "unknown", hours: 4, punchCount: 1 }];
  const g = rollupByDepartment(byEmployee, new Map());
  assert.equal(g.length, 1);
  assert.equal(g[0].key, "—");
  assert.equal(g[0].hours, 4);
});

test("department rollup preserves the total — nothing is dropped or double-counted", () => {
  const byEmployee = [
    { employeeId: "e1", hours: 10, punchCount: 3 },
    { employeeId: "e2", hours: 5, punchCount: 2 },
    { employeeId: "e3", hours: 8, punchCount: 1 },
    { employeeId: "e4", hours: 2.5, punchCount: 1 },
  ];
  const deptById = new Map([
    ["e1", "Mechanical Engineering"],
    ["e2", "Mechanical Engineering"],
    ["e3", "Controls Engineering"],
  ]); // e4 deliberately unmapped
  const expected = byEmployee.reduce((s, e) => s + e.hours, 0);
  const g = rollupByDepartment(byEmployee, deptById);
  const got = g.reduce((s, x) => s + x.hours, 0);
  assert.ok(Math.abs(got - expected) < 1e-9);
  assert.equal(
    g.reduce((s, x) => s + x.punchCount, 0),
    byEmployee.reduce((s, e) => s + e.punchCount, 0),
  );
});

test("department rollup sorts biggest first", () => {
  const byEmployee = [
    { employeeId: "e1", hours: 3, punchCount: 1 },
    { employeeId: "e2", hours: 30, punchCount: 1 },
  ];
  const deptById = new Map([
    ["e1", "Small Team"],
    ["e2", "Big Team"],
  ]);
  const g = rollupByDepartment(byEmployee, deptById);
  assert.equal(g[0].key, "Big Team");
  assert.equal(g[1].key, "Small Team");
});
