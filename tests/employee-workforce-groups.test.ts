import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPLOYEE_TEAMS } from "../src/lib/employee-teams";
import {
  WORKFORCE_GROUPS,
  workforceGroupForCardKey,
  workforceGroupTitle,
  EXECUTION_GROUP_KEYS,
  isExecutionGroup,
  groupInScope,
  DEFAULT_TEAM_SCOPE,
} from "../src/lib/employee-workforce-groups";
import { resolveEmployeeGroup } from "../src/lib/employee-card-theme";

// The task's own hierarchy, pinned down exactly (2026-08-24 revision):
//   Engineering: Mechanical Engineering, Controls Engineering, Service Engineering
//   Shop:        Mechanical Build / Manufacturing, Electrical Build, Manufacturing Operations
//   PM:          Project Execution / Project Management
//   Growth / Business Development: Growth / Business Development, Business Development, Sales
//   Finance:     Finance
//   Executive Leadership: Executive Leadership
//   Operations:  Operations

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

test("the four back-office groups own their own card keys — they are no longer swept into 'other'", () => {
  // Each of these resolved to "other" until 2026-08-24, when the request asked
  // for a card per department. Sales is deliberately NOT its own group: it is a
  // department card INSIDE Growth / Business Development.
  assert.equal(workforceGroupForCardKey("growth"), "growth");
  assert.equal(workforceGroupForCardKey("sales"), "growth");
  assert.equal(workforceGroupForCardKey("finance"), "finance");
  assert.equal(workforceGroupForCardKey("exec"), "exec");
  assert.equal(workforceGroupForCardKey("operations"), "operations");
});

test("an unmapped department still falls to 'other' rather than silently disappearing", () => {
  // The catch-all has to keep working, or a department nobody has mapped yet
  // (a new Paylocity string) would take its people off the tab entirely.
  assert.equal(workforceGroupForCardKey("Some Raw Department"), "other");
  assert.equal(workforceGroupForCardKey("No department"), "other");
});

test("no card key is claimed by two workforce groups", () => {
  const seen = new Map<string, string>();
  for (const g of WORKFORCE_GROUPS) {
    for (const code of [...g.teamCodes, ...(g.cardKeys ?? [])]) {
      const prior = seen.get(code);
      assert.ok(!prior, `${code} claimed by both "${prior}" and "${g.key}"`);
      seen.set(code, g.key);
    }
  }
});

test("workforceGroupTitle round-trips every defined group and defaults unknown keys to 'Other'", () => {
  assert.equal(workforceGroupTitle("engineering"), "Engineering");
  assert.equal(workforceGroupTitle("shop"), "Shop");
  assert.equal(workforceGroupTitle("pm"), "PM");
  assert.equal(workforceGroupTitle("growth"), "Growth / Business Development");
  assert.equal(workforceGroupTitle("finance"), "Finance");
  assert.equal(workforceGroupTitle("exec"), "Executive Leadership");
  assert.equal(workforceGroupTitle("operations"), "Operations");
  assert.equal(workforceGroupTitle("other"), "Other");
});

// ── The requested counts, verified through the REAL resolution chain ─────────
//
// The census below is the roster supplied with the request
// (Employee_Department_Map.xlsx, 79 people, 2026-08-24) reduced to
// department -> headcount. Only the department string matters for these people:
// it is the single input the grouping decision is made from.
//
// Deliberately run through resolveEmployeeGroup() and then
// workforceGroupForCardKey() — the same two calls WorkforceSummaryCards makes —
// rather than against a hand-written expectation of the mapping. A test that
// re-implemented the mapping would only agree with itself and prove nothing.
const ROSTER_CENSUS: Readonly<Record<string, number>> = {
  "Mechanical Engineering": 11,
  "Controls Engineering": 11,
  "Service Engineering": 5,
  "Mechanical Build / Manufacturing": 11,
  "Electrical Build": 9,
  "Manufacturing Operations": 9,
  "Project Execution / Project Management": 4,
  "Growth / Business Development": 7,
  "Business Development": 1,
  Sales: 1,
  Finance: 4,
  "Executive Leadership": 5,
  Operations: 1,
};

const EXPECTED_GROUP_COUNTS: Readonly<Record<string, number>> = {
  engineering: 27,
  shop: 29,
  pm: 4,
  growth: 9,
  finance: 4,
  exec: 5,
  operations: 1,
};

test("the supplied roster produces the requested per-card counts, with nobody dropped or double-counted", () => {
  const tally = new Map<string, number>();
  let uncarded = 0;

  for (const [department, headcount] of Object.entries(ROSTER_CENSUS)) {
    const card = resolveEmployeeGroup({ department });
    if (!card) {
      // resolveEmployeeGroup returning null means "on no card at all" — which
      // is what used to happen to Operations. Nobody in this roster may hit it.
      uncarded += headcount;
      continue;
    }
    const group = workforceGroupForCardKey(card.key);
    tally.set(group, (tally.get(group) ?? 0) + headcount);
  }

  assert.equal(uncarded, 0, "every employee must land on exactly one card");
  assert.deepEqual(Object.fromEntries([...tally].sort()), Object.fromEntries(Object.entries(EXPECTED_GROUP_COUNTS).sort()));

  // The sum as well as the per-group figures: together these are what
  // "no employee is omitted or double-counted" means.
  const total = [...tally.values()].reduce((a, b) => a + b, 0);
  assert.equal(total, Object.values(ROSTER_CENSUS).reduce((a, b) => a + b, 0), "the tally must account for every person in the census");
  assert.equal(total, 79);
});

test("Service Engineering and Manufacturing Operations get no card of their own", () => {
  // The request is explicit that these two must be COUNTED under Engineering
  // and Shop respectively, not shown as separate cards. They still exist as
  // department cards one level DOWN, which is the level a card click drills into.
  assert.equal(workforceGroupForCardKey(resolveEmployeeGroup({ department: "Service Engineering" })!.key), "engineering");
  assert.equal(workforceGroupForCardKey(resolveEmployeeGroup({ department: "Manufacturing Operations" })!.key), "shop");

  // No workforce-level card is named after either one.
  const titles = WORKFORCE_GROUPS.map((g) => g.title);
  assert.ok(!titles.includes("Service Engineering"), "Service Engineering must not be a card");
  assert.ok(!titles.includes("Manufacturing Operations"), "Manufacturing Operations must not be a card");
});

test("Operations and Manufacturing Operations are different departments", () => {
  // Easy to conflate by name, and they land in different groups — which is the
  // whole reason Operations had to come out of HIDDEN_DEPARTMENT_CARDS.
  const ops = resolveEmployeeGroup({ department: "Operations" });
  assert.ok(ops, "Operations must resolve to a card, not null");
  assert.equal(workforceGroupForCardKey(ops.key), "operations");
  assert.notEqual(
    workforceGroupForCardKey(ops.key),
    workforceGroupForCardKey(resolveEmployeeGroup({ department: "Manufacturing Operations" })!.key),
  );
});

// ── Team scope: Entire Team vs Execution Team (2026-08-24) ──────────────────

test("Execution Team is exactly Engineering, Shop and PM", () => {
  // The request's definition, asserted against the DERIVED set rather than
  // against a copy of it — EXECUTION_GROUP_KEYS is computed from which groups
  // own delivery-team codes, so this is what catches that derivation drifting
  // away from the spec (e.g. a back-office group accidentally given teamCodes).
  assert.deepEqual([...EXECUTION_GROUP_KEYS].sort(), ["engineering", "pm", "shop"]);
});

test("the back-office groups and the catch-all are NOT Execution Team", () => {
  for (const key of ["growth", "finance", "exec", "operations", "other"] as const) {
    assert.equal(isExecutionGroup(key), false, `${key} must not be part of the Execution Team`);
  }
});

test("every department of the three execution groups is in scope for Execution Team", () => {
  // Walks the request's own department lists through the real resolution chain,
  // so "Service Engineering counts under Engineering" and "Manufacturing
  // Operations counts under Shop" hold for this view too, not just the cards.
  const executionDepartments = [
    "Mechanical Engineering",
    "Controls Engineering",
    "Service Engineering",
    "Mechanical Build / Manufacturing",
    "Electrical Build",
    "Manufacturing Operations",
    "Project Execution / Project Management",
  ];
  for (const department of executionDepartments) {
    const card = resolveEmployeeGroup({ department });
    assert.ok(card, `${department} must resolve to a card`);
    assert.equal(groupInScope(workforceGroupForCardKey(card.key), "execution"), true, `${department} must be in the Execution Team`);
  }
});

test("the back-office departments are excluded from Execution Team but present in Entire Team", () => {
  for (const department of ["Growth / Business Development", "Business Development", "Sales", "Finance", "Executive Leadership", "Operations"]) {
    const card = resolveEmployeeGroup({ department });
    assert.ok(card, `${department} must resolve to a card`);
    const group = workforceGroupForCardKey(card.key);
    assert.equal(groupInScope(group, "execution"), false, `${department} must NOT be in the Execution Team`);
    assert.equal(groupInScope(group, "entire"), true, `${department} must be in the Entire Team`);
  }
});

test("Entire Team admits every group, including an unmapped department", () => {
  // Which is what lets the filter sites call groupInScope unconditionally
  // instead of branching on the scope themselves.
  for (const g of WORKFORCE_GROUPS) assert.equal(groupInScope(g.key, "entire"), true);
  assert.equal(groupInScope(workforceGroupForCardKey("Some Raw Department"), "entire"), true);
});

test("the default scope is Entire Team", () => {
  assert.equal(DEFAULT_TEAM_SCOPE, "entire");
});

test("the requested roster splits into 60 execution and 79 total", () => {
  // Same census as the per-card test above, partitioned by scope. Engineering
  // 27 + Shop 29 + PM 4 = 60 execution; the remaining 19 are back-office.
  let execution = 0;
  let entire = 0;
  for (const [department, headcount] of Object.entries(ROSTER_CENSUS)) {
    const card = resolveEmployeeGroup({ department });
    assert.ok(card, `${department} must resolve to a card`);
    const group = workforceGroupForCardKey(card.key);
    entire += headcount;
    if (groupInScope(group, "execution")) execution += headcount;
  }
  assert.equal(execution, 60, "Engineering 27 + Shop 29 + PM 4");
  assert.equal(entire, 79);
  assert.equal(entire - execution, 19, "Growth 9 + Finance 4 + Exec 5 + Operations 1");
});
