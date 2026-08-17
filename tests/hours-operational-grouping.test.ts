import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OPERATIONAL_GROUPING,
  UNDEFINED_LABEL,
  DEPARTMENT_ORDER,
  sectionNumberAndName,
  functionGroupFor,
  taskFor,
  departmentFor,
  departmentOrderRank,
  codesInSection,
  codesInFunctionGroup,
  codesInTask,
  codesInDepartment,
} from "../src/lib/hours-operational-grouping";
import { HOURS_IMPORT_CODES } from "../src/lib/sections";
import { rollupByOperationalTier } from "../src/lib/hours-filters";

// The Hours tab's acceptance rule is "sum of grouped hours = Total Hours KPI" for
// any filter, and "every recognized code appears under the standard group; an
// unrecognized one is clearly Undefined, never silently folded into another
// group." Both are decidable without a database, so they're tests here rather
// than a claim.

test("every code the app can import resolves to a real (non-Undefined) label at all four tiers", () => {
  for (const code of HOURS_IMPORT_CODES) {
    assert.ok(OPERATIONAL_GROUPING[code], `${code} has no entry in OPERATIONAL_GROUPING`);
    assert.notEqual(sectionNumberAndName(code).sectionName, UNDEFINED_LABEL, `${code} section name`);
    assert.notEqual(functionGroupFor(code), UNDEFINED_LABEL, `${code} function group`);
    assert.notEqual(taskFor(code), UNDEFINED_LABEL, `${code} task`);
    assert.notEqual(departmentFor(code), UNDEFINED_LABEL, `${code} department`);
  }
});

test("a code the table has never seen classifies as Undefined at every tier, not silently as something else", () => {
  const bogus = "99-999";
  assert.equal(sectionNumberAndName(bogus).sectionName, UNDEFINED_LABEL);
  assert.equal(sectionNumberAndName(bogus).sectionNumber, UNDEFINED_LABEL);
  assert.equal(functionGroupFor(bogus), UNDEFINED_LABEL);
  assert.equal(taskFor(bogus), UNDEFINED_LABEL);
  assert.equal(departmentFor(bogus), UNDEFINED_LABEL);
});

test("reverse lookups round-trip the forward map — every code appears under its own section/group/task/department", () => {
  for (const [code, entry] of Object.entries(OPERATIONAL_GROUPING)) {
    assert.ok(codesInSection(entry.sectionNumber).includes(code), `${code} missing from codesInSection(${entry.sectionNumber})`);
    assert.ok(codesInFunctionGroup(entry.functionGroup).includes(code), `${code} missing from codesInFunctionGroup(${entry.functionGroup})`);
    assert.ok(codesInTask(entry.task).includes(code), `${code} missing from codesInTask(${entry.task})`);
    assert.ok(codesInDepartment(entry.department).includes(code), `${code} missing from codesInDepartment(${entry.department})`);
  }
});

// ── Department: its own tier, not an alias for Function Group (2026-08-17) ──

test("department splits Section 10's Shop by exact function — Mechanical Build / Electrical Build / Manufacturing Operations", () => {
  assert.equal(departmentFor("10-411"), "Mechanical Build");
  assert.equal(departmentFor("10-412"), "Electrical Build");
  assert.equal(departmentFor("10-413"), "Manufacturing Operations");
  // Function Group, by contrast, collapses all three into one "Shop" — the
  // two tiers are deliberately different cuts of the same codes.
  assert.equal(functionGroupFor("10-411"), "Shop");
  assert.equal(functionGroupFor("10-412"), "Shop");
  assert.equal(functionGroupFor("10-413"), "Shop");
});

test("department combines Section Name and Engineering/Shop for 40/50/70/80/90, per request", () => {
  assert.equal(departmentFor("40-211"), "Machine Testing — Engineering");
  assert.equal(departmentFor("40-411"), "Machine Testing — Shop");
  assert.equal(departmentFor("50-211"), "Teardown & Install — Engineering");
  assert.equal(departmentFor("70-411"), "Warranty — Shop");
  assert.equal(departmentFor("80-211"), "Service — Engineering");
  assert.equal(departmentFor("90-411"), "Spare Parts — Shop");
});

test("department never produces a raw employee/HR department string", () => {
  // The exact invalid groups reported in the regression.
  const invalid = new Set(["Mechanical Build / Manufacturing", "Manufacturing", "Machine Wiring", "Electrical Engineering", "Unassigned", "—"]);
  for (const code of HOURS_IMPORT_CODES) {
    assert.ok(!invalid.has(departmentFor(code)), `${code} resolved to "${departmentFor(code)}", a raw HR-looking department value`);
  }
});

test("Function Group rolls up across sections when nothing narrower is chosen — Engineering spans Testing/Teardown/Warranty/Service", () => {
  const engineeringCodes = codesInFunctionGroup("Engineering");
  assert.ok(engineeringCodes.includes("40-211"));
  assert.ok(engineeringCodes.includes("50-211"));
  assert.ok(engineeringCodes.includes("70-211"));
  assert.ok(engineeringCodes.includes("80-211"));
});

test("Spare Parts stays one flat Function Group, per request — no Engineering/Shop split", () => {
  for (const code of ["90-211", "90-311", "90-411", "90-412", "90-414"]) {
    assert.equal(functionGroupFor(code), "Spare parts");
  }
});

test("rollupByOperationalTier: sectionName reconciles to the input total, unmapped code included", () => {
  const bySection = [
    { section: "10-313", hours: 10, punchCount: 2 }, // Complete Design and Build
    { section: "10-411", hours: 5, punchCount: 1 }, // Complete Design and Build
    { section: "80-211", hours: 3, punchCount: 1 }, // Service
    { section: "99-999", hours: 1, punchCount: 1 }, // unmapped
  ];
  const g = rollupByOperationalTier(bySection, "sectionName");
  const expected = bySection.reduce((s, r) => s + r.hours, 0);
  const got = g.reduce((s, r) => s + r.hours, 0);
  assert.ok(Math.abs(got - expected) < 1e-9);
  assert.equal(g.reduce((s, r) => s + r.punchCount, 0), bySection.reduce((s, r) => s + r.punchCount, 0));

  const designBuild = g.find((r) => r.label === "Complete Design and Build")!;
  assert.equal(designBuild.hours, 15);
  const service = g.find((r) => r.label === "Service")!;
  assert.equal(service.hours, 3);
  const undefinedGroup = g.find((r) => r.label === UNDEFINED_LABEL)!;
  assert.equal(undefinedGroup.hours, 1);
});

test("rollupByOperationalTier: functionGroup merges same-named groups across sections", () => {
  const bySection = [
    { section: "40-211", hours: 10, punchCount: 1 }, // Machine Testing / Engineering
    { section: "70-211", hours: 20, punchCount: 1 }, // Warranty / Engineering
  ];
  const g = rollupByOperationalTier(bySection, "functionGroup");
  assert.equal(g.length, 1);
  assert.equal(g[0].label, "Engineering");
  assert.equal(g[0].hours, 30);
});

test("rollupByOperationalTier: taskDescription merges Manufacturing across its two raw sources", () => {
  const bySection = [
    { section: "10-413", hours: 7, punchCount: 1 },
    { section: "90-414", hours: 3, punchCount: 1 }, // same task label, different section
  ];
  const g = rollupByOperationalTier(bySection, "taskDescription");
  const mfg = g.find((r) => r.label === "Manufacturing")!;
  assert.equal(mfg.hours, 10);
});

// ── Department reads in a fixed business order, never by hours (2026-08-17) ─

test("every department a real code can resolve to has a position in DEPARTMENT_ORDER", () => {
  const realDepartments = new Set(Object.values(OPERATIONAL_GROUPING).map((e) => e.department));
  for (const d of realDepartments) {
    assert.ok(DEPARTMENT_ORDER.includes(d), `"${d}" is a real department but missing from DEPARTMENT_ORDER`);
  }
});

test("departmentOrderRank follows the exact given sequence", () => {
  assert.equal(departmentOrderRank("Project Management"), 0);
  assert.equal(departmentOrderRank("Mechanical Engineering"), 1);
  assert.equal(departmentOrderRank("Controls Engineering"), 2);
  assert.ok(departmentOrderRank("Mechanical Build") < departmentOrderRank("Electrical Build"));
  assert.ok(departmentOrderRank("Electrical Build") < departmentOrderRank("Manufacturing Operations"));
  assert.ok(departmentOrderRank("Manufacturing Operations") < departmentOrderRank("Service — Engineering"));
});

test("an unrecognized department (including UNDEFINED_LABEL) ranks after every real one", () => {
  const maxRealRank = Math.max(...DEPARTMENT_ORDER.map((d) => departmentOrderRank(d)));
  assert.ok(departmentOrderRank(UNDEFINED_LABEL) > maxRealRank);
  assert.ok(departmentOrderRank("Some Made Up Department") > maxRealRank);
});

test("rollupByOperationalTier's department tier sorts by the fixed order, NOT by hours descending", () => {
  // Deliberately built so hours-descending would produce the OPPOSITE order:
  // Manufacturing Operations has the most hours but must still sort AFTER
  // Project Management, which has the fewest.
  const bySection = [
    { section: "10-413", hours: 500, punchCount: 1 }, // Manufacturing Operations
    { section: "10-211", hours: 200, punchCount: 1 }, // Mechanical Engineering
    { section: "10-111", hours: 10, punchCount: 1 }, // Project Management
  ];
  const g = rollupByOperationalTier(bySection, "department");
  assert.deepEqual(
    g.map((r) => r.label),
    ["Project Management", "Mechanical Engineering", "Manufacturing Operations"],
    "must follow DEPARTMENT_ORDER, not the 500/200/10 hours ordering",
  );
});

test("the other three tiers are UNAFFECTED — they still sort biggest-first", () => {
  const bySection = [
    { section: "10-111", hours: 10, punchCount: 1 }, // Complete Design and Build
    { section: "80-211", hours: 500, punchCount: 1 }, // Service
  ];
  const bySectionName = rollupByOperationalTier(bySection, "sectionName");
  assert.equal(bySectionName[0].label, "Service", "sectionName must still sort by hours, unchanged by the department fix");
});
