import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPLOYEE_TEAMS } from "../src/lib/employee-teams";
import { WORKFORCE_GROUPS, workforceGroupForCardKey, workforceGroupTitle } from "../src/lib/employee-workforce-groups";

// The task's own hierarchy, pinned down exactly:
//   Engineering: Mechanical Engineering, Controls Engineering, Service Engineering
//   Shop:        Mechanical Build, Electrical Build, Manufacturing Operations
//   PM:          Project Management

test("every one of the seven delivery teams lands in Engineering, Shop, or PM — never 'other'", () => {
  for (const team of EMPLOYEE_TEAMS) {
    const group = workforceGroupForCardKey(team.schedulerCode);
    assert.notEqual(group, "other", `${team.name} (${team.schedulerCode}) must belong to a real workforce group`);
  }
});

test("Engineering is exactly Mechanical/Controls/Service Engineering", () => {
  assert.equal(workforceGroupForCardKey("mech"), "engineering");
  assert.equal(workforceGroupForCardKey("controls"), "engineering");
  assert.equal(workforceGroupForCardKey("service"), "engineering");
});

test("Shop is exactly Mechanical Build/Electrical Build/Manufacturing Operations", () => {
  assert.equal(workforceGroupForCardKey("build"), "shop");
  assert.equal(workforceGroupForCardKey("wire"), "shop");
  assert.equal(workforceGroupForCardKey("mfgops"), "shop");
});

test("PM is exactly Project Management", () => {
  assert.equal(workforceGroupForCardKey("pm"), "pm");
});

test("no team code is claimed by two workforce groups", () => {
  const seen = new Map<string, string>();
  for (const g of WORKFORCE_GROUPS) {
    for (const code of g.teamCodes) {
      const prior = seen.get(code);
      assert.ok(!prior, `${code} claimed by both "${prior}" and "${g.key}"`);
      seen.set(code, g.key);
    }
  }
});

test("a card key that isn't one of the nine team codes falls to 'other', not silently disappearing", () => {
  assert.equal(workforceGroupForCardKey("finance"), "other");
  assert.equal(workforceGroupForCardKey("growth"), "other");
  assert.equal(workforceGroupForCardKey("sales"), "other");
  assert.equal(workforceGroupForCardKey("exec"), "other");
  assert.equal(workforceGroupForCardKey("Some Raw Department"), "other");
  assert.equal(workforceGroupForCardKey("No department"), "other");
});

test("workforceGroupTitle round-trips every defined group and defaults unknown keys to 'Other'", () => {
  assert.equal(workforceGroupTitle("engineering"), "Engineering");
  assert.equal(workforceGroupTitle("shop"), "Shop");
  assert.equal(workforceGroupTitle("pm"), "PM");
  assert.equal(workforceGroupTitle("other"), "Other");
});
