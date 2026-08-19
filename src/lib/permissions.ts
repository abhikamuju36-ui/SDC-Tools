// ── Role-based access control ────────────────────────────────────────────────
//
// Deliberately dependency-free (no React, no Prisma, no `@/` imports) — the
// same reason etc-departments.ts and sections.ts are: `tsx --test` can load it
// directly, and it needs to run from proxy.ts (Node runtime), server
// components, server actions, and client components alike without dragging
// any of those environments' assumptions into the other.
//
// Hierarchy: ALL < MANAGER < SALES < ELT. Higher tiers inherit every lower
// tier's permissions — OWN_PERMISSIONS below lists only what a tier adds on
// top of the one below it; hasPermission() walks the chain.

export type AppRole = "ALL" | "MANAGER" | "SALES" | "ELT";

export const ROLES: readonly AppRole[] = ["ALL", "MANAGER", "SALES", "ELT"];

export type Permission =
  | "job-hour-details:view"
  | "job-hour-details:schedule"
  | "build-readiness:view"
  | "projects:view"
  | "projects:edit"
  | "monthly-etc:view"
  | "hours:view"
  | "dashboard:view"
  | "standards:view"
  | "standards:edit"
  | "standards:pm"
  | "standards:mfg"
  | "standards:warranty"
  | "employees:view"
  | "employees:edit"
  | "employees:hiring:assign"
  | "audit-log:view"
  | "profitability:view"
  | "users:manage"
  | "permissions:manage"
  | "tm:view";

// The shape every tier's OWN grants take — never flattened, hasPermission()
// is the one place inheritance is resolved. This used to be the actual data
// (a `const`); now it's just the type and the day-one fallback, since
// role-permissions-store.ts made it live-editable (2026-08-18).
type OwnPermissionsShape = Record<AppRole, readonly Permission[]>;

// What ships in code, and what the app falls back to if the database is ever
// unreachable at boot (role-permissions-store.ts's loadRolePermissionsFromDb
// normally overwrites this before the first real request). Turning on the
// Role Permissions admin tab was seeded to match this exactly, so day one
// changes nobody's access — see the seed migration.
const DEFAULT_OWN_PERMISSIONS: OwnPermissionsShape = {
  ALL: ["job-hour-details:view", "job-hour-details:schedule", "build-readiness:view"],
  MANAGER: ["projects:view", "monthly-etc:view", "hours:view", "dashboard:view", "employees:view"],
  SALES: [
    "projects:edit",
    "standards:view",
    "standards:edit",
    "standards:pm",
    "standards:mfg",
    "standards:warranty",
    "profitability:view",
  ],
  // ELT's real answer is "everything" (see the wildcard in hasPermission) —
  // this list only needs to name what ELT is the FIRST tier to receive, so
  // that roleAtLeast()-style "who's the lowest tier with this" questions have
  // a real place to point. permissions:manage lives here for the same
  // reason users:manage already did — redundant under the wildcard, but
  // keeps the type and the DB seed honest about who's first to get it.
  ELT: ["employees:edit", "employees:hiring:assign", "audit-log:view", "users:manage", "permissions:manage", "tm:view"],
};

// ── Why globalThis, not a plain module-level `let` ──────────────────────────
//
// Found live once already for realtime-hub.ts, and the identical problem
// applies here: Next.js bundles Server Actions separately from Route
// Handlers/Server Components. A plain `let OWN_PERMISSIONS` would silently
// become two different variables in two different bundles — a write from
// the Role Permissions page's server action (a Server Action bundle) would
// be invisible to proxy.ts or a page.tsx read (a different bundle). Pinning
// to `globalThis` makes every bundle in this one Node.js process share the
// same slot, the same fix realtime-hub.ts already uses for its own state.
const g = globalThis as unknown as { __ownPermissions?: OwnPermissionsShape };
if (!g.__ownPermissions) g.__ownPermissions = DEFAULT_OWN_PERMISSIONS;

/**
 * Swaps in a freshly-loaded permission set — called by
 * role-permissions-store.ts after a DB read (boot) or a write (an ELT
 * user's save). Every hasPermission() call anywhere in this process sees the
 * new data on its very next invocation; no restart, no cache TTL.
 */
export function setOwnPermissions(next: OwnPermissionsShape): void {
  g.__ownPermissions = next;
}

const ROLE_RANK: Record<AppRole, number> = { ALL: 0, MANAGER: 1, SALES: 2, ELT: 3 };

/**
 * The one function every enforcement point calls — proxy.ts, page-level
 * guards, server actions, and the sidebar's nav filter. ELT is a wildcard: it
 * passes for ANY permission, including ones added after this file was last
 * touched, per "any future restricted feature unless explicitly excluded."
 * This check is untouched by the live-editable store below on purpose — it's
 * what guarantees an ELT user can never lock their own tier out by
 * misconfiguring the Role Permissions matrix.
 */
export function hasPermission(role: AppRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  if (role === "ELT") return true;
  const ownPermissions = g.__ownPermissions!;
  for (const r of ROLES) {
    if (ROLE_RANK[r] <= ROLE_RANK[role] && ownPermissions[r].includes(permission)) return true;
  }
  return false;
}

/** For "Managers and up" style checks that aren't about one named permission. */
export function roleAtLeast(role: AppRole | null | undefined, min: AppRole): boolean {
  return !!role && ROLE_RANK[role] >= ROLE_RANK[min];
}

/**
 * Roles a Role Permissions matrix save can actually change (role-permissions-
 * store.ts) — ELT is never included. ELT's access comes from the wildcard in
 * hasPermission() above, unconditionally, so there is no row for it in that
 * table and nothing here to cascade into or out of.
 */
export const EDITABLE_ROLES: readonly Exclude<AppRole, "ELT">[] = ["ALL", "MANAGER", "SALES"];

/**
 * The Role Permissions matrix's cascade rule, pulled out as a pure function
 * so it's testable without a database — role-permissions-store.ts needs
 * `import "server-only"`, which (per its own and realtime-hub.ts's notes)
 * isn't importable from this repo's plain `tsx --test` runner. Which
 * editable roles a write to `role` touches: enabling reaches `role` and
 * everything ABOVE it; disabling reaches `role` and everything AT OR BELOW
 * it. This is what makes a hierarchy gap structurally impossible rather
 * than merely checked-for — there is no write path that touches only one
 * role in the middle of the chain.
 */
export function affectedRolesForCascade(role: AppRole, enabling: boolean): Exclude<AppRole, "ELT">[] {
  const targetRank = ROLE_RANK[role];
  return EDITABLE_ROLES.filter((r) => (enabling ? ROLE_RANK[r] >= targetRank : ROLE_RANK[r] <= targetRank));
}
