import "server-only";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { publishPermissionsChanged } from "@/lib/realtime-hub";
import { setOwnPermissions, affectedRolesForCascade, EDITABLE_ROLES, type AppRole, type Permission } from "@/lib/permissions";

// The live-editable half of the role/permission system — the DB-backed
// source lib/permissions.ts's in-memory cache is loaded from at boot and
// refreshed from on every ELT save. RolePermission has no generated Prisma
// Client type yet (`prisma generate` is blocked on this box while a server
// process holds node_modules/.prisma open — the same standing constraint
// documented on DepartmentEtcCompletion/Employee.team), so this reads and
// writes it with $queryRaw/$executeRaw, same as employee-team-field.ts.
//
// ELT is never stored here — hasPermission()'s wildcard is what actually
// grants ELT everything, unconditionally, before this table is even
// consulted. Keeping ELT out of the table entirely (rather than seeding it
// `true` and hoping nothing ever flips it) means there is no row an ELT user
// could accidentally disable to lock their own tier out. EDITABLE_ROLES
// itself lives in lib/permissions.ts, shared with the matrix's cascade rule.

type RolePermissionRow = { role: AppRole; permission: string; enabled: boolean };

function buildOwnPermissionsShape(rows: RolePermissionRow[]): Record<AppRole, readonly Permission[]> {
  const byRole: Record<AppRole, Permission[]> = { ALL: [], MANAGER: [], SALES: [], ELT: [] };
  for (const r of rows) {
    if (r.enabled) byRole[r.role].push(r.permission as Permission);
  }
  return byRole;
}

/** Called once at process boot (src/instrumentation.ts) — populates the live cache from the DB. */
export async function loadRolePermissionsFromDb(): Promise<void> {
  const rows = await prisma.$queryRaw<RolePermissionRow[]>`SELECT role, permission, enabled FROM RolePermission`;
  setOwnPermissions(buildOwnPermissionsShape(rows));
}

export type RolePermissionMatrixRow = {
  permission: Permission;
  enabled: Record<Exclude<AppRole, "ELT">, boolean>;
};

/** Current state for every stored permission, for the admin page to render. ELT isn't included — it's always true, drawn by the UI, never read from here. */
export async function getRolePermissionsMatrix(): Promise<RolePermissionMatrixRow[]> {
  const rows = await prisma.$queryRaw<RolePermissionRow[]>`SELECT role, permission, enabled FROM RolePermission`;
  const byPermission = new Map<Permission, RolePermissionMatrixRow>();
  for (const r of rows) {
    const key = r.permission as Permission;
    let row = byPermission.get(key);
    if (!row) {
      row = { permission: key, enabled: { ALL: false, MANAGER: false, SALES: false } };
      byPermission.set(key, row);
    }
    if (r.role !== "ELT") row.enabled[r.role] = r.enabled;
  }
  return [...byPermission.values()];
}

export type SetRolePermissionResult =
  | { ok: true; changed: { role: AppRole; enabled: boolean }[] }
  | { ok: false; error: string };

/**
 * The one write path. Cascades so a hierarchy gap is structurally impossible
 * rather than merely validated against: enabling a permission for `role`
 * also enables it for every editable role ABOVE it (checking a lower tier
 * implies every higher tier already had it); disabling disables it for
 * `role` and every editable role AT OR BELOW it. ELT is refused outright —
 * defense in depth on top of the fact that hasPermission()'s wildcard makes
 * a stored ELT row meaningless anyway.
 */
export async function setRolePermission(
  role: AppRole,
  permission: Permission,
  enabled: boolean,
  actorEmail: string | null,
): Promise<SetRolePermissionResult> {
  if (role === "ELT") return { ok: false, error: "ELT always has full access — it can't be changed here." };
  if (!EDITABLE_ROLES.includes(role)) return { ok: false, error: `"${role}" is not a role this can change.` };

  const affected = affectedRolesForCascade(role, enabled);

  const changed: { role: AppRole; enabled: boolean }[] = [];
  for (const r of affected) {
    const existing = await prisma.$queryRaw<{ enabled: boolean }[]>`
      SELECT enabled FROM RolePermission WHERE role = ${r} AND permission = ${permission} LIMIT 1
    `;
    const before = existing[0]?.enabled ?? false;
    if (before === enabled) continue; // already correct — no row touched, nothing to audit

    await prisma.$executeRaw`
      INSERT INTO RolePermission (role, permission, enabled, updatedAt, updatedByEmail)
      VALUES (${r}, ${permission}, ${enabled}, NOW(3), ${actorEmail})
      ON DUPLICATE KEY UPDATE enabled = ${enabled}, updatedAt = NOW(3), updatedByEmail = ${actorEmail}
    `;
    changed.push({ role: r, enabled });
    await logAudit({
      action: "permission.updated",
      entityType: "RolePermission",
      entityId: `${r}:${permission}`,
      summary: `${permission} for ${r} set to ${enabled ? "on" : "off"} by ${actorEmail ?? "unknown"}`,
      metadata: { role: r, permission, before, after: enabled },
    });
  }

  if (changed.length > 0) {
    // Re-read the whole table rather than patch the in-memory shape by hand —
    // the table is small (dozens of rows), and re-deriving from the DB is one
    // fewer place this and loadRolePermissionsFromDb could quietly disagree.
    await loadRolePermissionsFromDb();
    publishPermissionsChanged();
  }

  return { ok: true, changed };
}
