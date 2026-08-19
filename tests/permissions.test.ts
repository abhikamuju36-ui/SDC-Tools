import { test } from "node:test";
import assert from "node:assert/strict";
import { hasPermission, roleAtLeast, affectedRolesForCascade, EDITABLE_ROLES, type AppRole, type Permission } from "../src/lib/permissions";
import { permissionForPath, safeFallbackPath, ROUTE_PERMISSIONS } from "../src/lib/route-permissions";

// ── The role hierarchy: All < Managers < Sales < ELT ─────────────────────────
//
// Each tier inherits everything the tier below it has — these tests pin the
// exact grants named in the spec, not just "some permission works", since a
// hierarchy bug usually looks like "this role has one thing too many/few".

test("no role and null/undefined role have no permissions", () => {
  assert.equal(hasPermission(null, "dashboard:view"), false);
  assert.equal(hasPermission(undefined, "dashboard:view"), false);
});

test("ALL has exactly the base tier's grants", () => {
  const granted: Permission[] = ["job-hour-details:view", "job-hour-details:schedule", "build-readiness:view"];
  for (const p of granted) assert.equal(hasPermission("ALL", p), true, p);

  const denied: Permission[] = [
    "projects:view",
    "projects:edit",
    "monthly-etc:view",
    "hours:view",
    "dashboard:view",
    "employees:view",
    "standards:view",
    "audit-log:view",
    "profitability:view",
  ];
  for (const p of denied) assert.equal(hasPermission("ALL", p), false, p);
});

test("MANAGER inherits ALL, plus its own view-only grants", () => {
  // Inherited
  for (const p of ["job-hour-details:view", "job-hour-details:schedule", "build-readiness:view"] as Permission[]) {
    assert.equal(hasPermission("MANAGER", p), true, `MANAGER should inherit ${p}`);
  }
  // Own
  for (const p of ["projects:view", "monthly-etc:view", "hours:view", "dashboard:view", "employees:view"] as Permission[]) {
    assert.equal(hasPermission("MANAGER", p), true, p);
  }
  // Not yet
  for (const p of ["projects:edit", "standards:view", "standards:edit", "standards:pm", "standards:mfg", "standards:warranty", "profitability:view", "audit-log:view"] as Permission[]) {
    assert.equal(hasPermission("MANAGER", p), false, p);
  }
});

test("SALES inherits MANAGER, plus Projects edit and all three Standard Fees categories", () => {
  for (const p of ["projects:view", "monthly-etc:view", "hours:view", "dashboard:view"] as Permission[]) {
    assert.equal(hasPermission("SALES", p), true, `SALES should inherit ${p}`);
  }
  for (const p of [
    "projects:edit",
    "standards:view",
    "standards:edit",
    "standards:pm",
    "standards:mfg",
    "standards:warranty",
    "profitability:view",
  ] as Permission[]) {
    assert.equal(hasPermission("SALES", p), true, p);
  }
  // ELT-only things stay ELT-only
  for (const p of ["audit-log:view", "employees:edit", "users:manage"] as Permission[]) {
    assert.equal(hasPermission("SALES", p), false, p);
  }
});

test("ELT passes for everything, including a permission invented after this file was last touched", () => {
  const known: Permission[] = [
    "job-hour-details:view",
    "projects:edit",
    "standards:warranty",
    "audit-log:view",
    "employees:edit",
    "users:manage",
  ];
  for (const p of known) assert.equal(hasPermission("ELT", p), true, p);

  // The wildcard: a permission string that doesn't exist in OWN_PERMISSIONS
  // anywhere still passes for ELT, per "any future restricted feature unless
  // explicitly excluded".
  assert.equal(hasPermission("ELT", "some-future-feature:view" as Permission), true);
});

test("roleAtLeast respects the same ordering", () => {
  const order: AppRole[] = ["ALL", "MANAGER", "SALES", "ELT"];
  for (let i = 0; i < order.length; i++) {
    for (let j = 0; j < order.length; j++) {
      assert.equal(roleAtLeast(order[i], order[j]), i >= j, `${order[i]} at least ${order[j]}`);
    }
  }
  assert.equal(roleAtLeast(null, "ALL"), false);
  assert.equal(roleAtLeast(undefined, "ALL"), false);
});

// ── The route map that proxy.ts and Sidebar.tsx both read ───────────────────

test("every top-level tab resolves to a permission", () => {
  const routes: [string, Permission][] = [
    ["/", "dashboard:view"],
    ["/job-hours", "job-hour-details:view"],
    ["/build-readiness", "build-readiness:view"],
    ["/quoted", "projects:view"],
    ["/etc", "monthly-etc:view"],
    ["/hours", "hours:view"],
    ["/employees", "employees:view"],
    ["/audit-log", "audit-log:view"],
    ["/job-cost-explorer", "profitability:view"],
    ["/admin/users", "users:manage"],
  ];
  for (const [path, permission] of routes) {
    assert.equal(permissionForPath(path), permission, path);
  }
});

test("a sub-path inherits its top-level route's permission", () => {
  assert.equal(permissionForPath("/quoted/new"), "projects:view");
  assert.equal(permissionForPath("/job-hours?jobs=1079"), "job-hour-details:view");
});

test("only the exact root path resolves to dashboard:view", () => {
  // "/" is a prefix of every path, so it must be matched last / exactly, or
  // every route in the app would silently resolve to the Dashboard's
  // permission.
  assert.notEqual(permissionForPath("/quoted"), "dashboard:view");
  assert.notEqual(permissionForPath("/etc"), "dashboard:view");
});

// ── The redirect-loop regression (2026-08-18, ERR_TOO_MANY_REDIRECTS) ───────
//
// "/" requires dashboard:view, which the base ALL tier does not have. Every
// "permission denied" redirect used to land on a hardcoded "/", so an ALL
// role denied anywhere was sent to "/" and immediately refused "/" too —
// forever. safeFallbackPath must never be able to reproduce that: for every
// real role, it has to resolve to a route that role actually has permission
// for, full stop.

test("safeFallbackPath never points at a route the role can't see", () => {
  for (const role of ["ALL", "MANAGER", "SALES", "ELT"] as AppRole[]) {
    const path = safeFallbackPath(role);
    const permission = permissionForPath(path);
    assert.ok(permission, `safeFallbackPath(${role}) = "${path}" has no known permission at all`);
    assert.equal(hasPermission(role, permission), true, `${role} was sent to "${path}" but lacks ${permission}`);
  }
});

test("safeFallbackPath never resolves to dashboard:view — that's the exact loop this fixes", () => {
  for (const role of ["ALL", "MANAGER", "SALES", "ELT"] as AppRole[]) {
    assert.notEqual(safeFallbackPath(role), "/", `${role} must not be sent to "/"`);
  }
});

test("a role with no session at all falls back to /login, not a loop", () => {
  assert.equal(safeFallbackPath(null), "/login");
  assert.equal(safeFallbackPath(undefined), "/login");
});

test("every route in the map is reachable by SOME role — no permission is unassigned", () => {
  for (const { path, permission } of ROUTE_PERMISSIONS) {
    const reachable = (["ALL", "MANAGER", "SALES", "ELT"] as AppRole[]).some((r) => hasPermission(r, permission));
    assert.ok(reachable, `no role has ${permission} (route ${path}) — it would 404-loop for everyone`);
  }
});

// ── Role Permissions matrix: the cascade rule can't produce a hierarchy gap ──
//
// role-permissions-store.ts's setRolePermission() applies whatever
// affectedRolesForCascade() returns as ONE write — these tests are the
// guarantee that its answer can never leave a state where a lower tier has a
// permission a higher tier doesn't.

test("ELT is never in the cascade — it has no row to touch", () => {
  for (const enabling of [true, false]) {
    assert.ok(!affectedRolesForCascade("ALL", enabling).includes("ELT" as never));
    assert.ok(!affectedRolesForCascade("SALES", enabling).includes("ELT" as never));
  }
  assert.deepEqual(EDITABLE_ROLES, ["ALL", "MANAGER", "SALES"]);
});

test("enabling a tier also reaches every tier above it, never below", () => {
  assert.deepEqual(affectedRolesForCascade("ALL", true), ["ALL", "MANAGER", "SALES"]);
  assert.deepEqual(affectedRolesForCascade("MANAGER", true), ["MANAGER", "SALES"]);
  assert.deepEqual(affectedRolesForCascade("SALES", true), ["SALES"]);
});

test("disabling a tier also reaches every tier at or below it, never above", () => {
  assert.deepEqual(affectedRolesForCascade("SALES", false), ["ALL", "MANAGER", "SALES"]);
  assert.deepEqual(affectedRolesForCascade("MANAGER", false), ["ALL", "MANAGER"]);
  assert.deepEqual(affectedRolesForCascade("ALL", false), ["ALL"]);
});

test("simulating every possible save leaves a monotonic (gap-free) row", () => {
  // Model the whole editable tier as a boolean array and apply the exact same
  // cascade a real save would, for every REACHABLE starting state and every
  // possible click — the row must stay monotonic (once true, true for every
  // tier after it) after every single one. "Reachable" matters: the cascade
  // only promises to keep a CONSISTENT row consistent, not to repair a state
  // nothing here could have produced in the first place (e.g. Managers=true
  // with Sales=false) — so the starting states under test are exactly the
  // four monotonic ones a threshold (nothing / Sales-up / Managers-up / all)
  // describes, not all eight raw boolean combinations.
  const rank: Record<Exclude<AppRole, "ELT">, number> = { ALL: 0, MANAGER: 1, SALES: 2 };
  const reachableStartStates: Record<Exclude<AppRole, "ELT">, boolean>[] = [0, 1, 2, 3].map((threshold) => ({
    ALL: rank.ALL >= threshold,
    MANAGER: rank.MANAGER >= threshold,
    SALES: rank.SALES >= threshold,
  }));
  for (const state of reachableStartStates) {
    for (const clicked of EDITABLE_ROLES) {
      for (const next of [true, false]) {
        const applied = { ...state };
        for (const r of affectedRolesForCascade(clicked, next)) applied[r as Exclude<AppRole, "ELT">] = next;
        // Monotonic: for any two tiers, the lower-ranked one being true implies the higher-ranked one is true too.
        for (const a of EDITABLE_ROLES) {
          for (const b of EDITABLE_ROLES) {
            if (rank[a] < rank[b] && applied[a] && !applied[b]) {
              assert.fail(`gap after clicking ${clicked}->${next} from ${JSON.stringify(state)}: ${a} true but ${b} false`);
            }
          }
        }
      }
    }
  }
});
