import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OPERATIONAL_GROUPING,
  UNDEFINED_LABEL,
  sectionNumberAndName,
  functionGroupFor,
  taskFor,
  codesInSection,
  codesInFunctionGroup,
  codesInTask,
} from "../src/lib/hours-operational-grouping";
import { HOURS_IMPORT_CODES } from "../src/lib/sections";
import { rollupByOperationalTier } from "../src/lib/hours-filters";

// The Hours tab's acceptance rule is "sum of grouped hours = Total Hours KPI" for
// any filter, and "every recognized code appears under the standard group; an
// unrecognized one is clearly Undefined, never silently folded into another
// group." Both are decidable without a database, so they're tests here rather
// than a claim.

test("every code the app can import resolves to a real (non-Undefined) label at all three tiers", () => {
  for (const code of HOURS_IMPORT_CODES) {
    assert.ok(OPERATIONAL_GROUPING[code], `${code} has no entry in OPERATIONAL_GROUPING`);
    assert.notEqual(sectionNumberAndName(code).sectionName, UNDEFINED_LABEL, `${code} section name`);
    assert.notEqual(functionGroupFor(code), UNDEFINED_LABEL, `${code} function group`);
    assert.notEqual(taskFor(code), UNDEFINED_LABEL, `${code} task`);
  }
});

test("a code the table has never seen classifies as Undefined at every tier, not silently as something else", () => {
  const bogus = "99-999";
  assert.equal(sectionNumberAndName(bogus).sectionName, UNDEFINED_LABEL);
  assert.equal(sectionNumberAndName(bogus).sectionNumber, UNDEFINED_LABEL);
  assert.equal(functionGroupFor(bogus), UNDEFINED_LABEL);
  assert.equal(taskFor(bogus), UNDEFINED_LABEL);
});

test("reverse lookups round-trip the forward map — every code appears under its own section/group/task", () => {
  for (const [code, entry] of Object.entries(OPERATIONAL_GROUPING)) {
    assert.ok(codesInSection(entry.sectionNumber).includes(code), `${code} missing from codesInSection(${entry.sectionNumber})`);
    assert.ok(codesInFunctionGroup(entry.functionGroup).includes(code), `${code} missing from codesInFunctionGroup(${entry.functionGroup})`);
    assert.ok(codesInTask(entry.task).includes(code), `${code} missing from codesInTask(${entry.task})`);
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
