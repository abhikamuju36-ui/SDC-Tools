import type { Permission } from "@/lib/permissions";

// The Role Permissions matrix's presentation layer — which section each
// permission shows under, its human label, and which ROWS control more than
// one Permission key together. Dependency-free (no React/Prisma) so both the
// admin page (server) and the matrix component (client) import the same
// list rather than keeping two.
//
// "Standard Fees" is the one row backing two keys at once (standards:view +
// standards:edit) — by request, matching the sketched table exactly rather
// than splitting it like Projects. Every other row is one key.
export type PermissionCatalogEntry = {
  keys: readonly [Permission, ...Permission[]];
  label: string;
  section: string;
  /** Rendered indented, as a sub-item of the row above it (PM/Mfg/Warranty under Standard Fees). */
  indent?: boolean;
};

export const PERMISSION_SECTIONS = ["General", "Projects", "Monthly ETC", "Hours", "Standards", "Financial", "Administration"] as const;

export const PERMISSION_CATALOG: readonly PermissionCatalogEntry[] = [
  { keys: ["job-hour-details:view"], label: "Job Hour Details", section: "General" },
  { keys: ["job-hour-details:schedule"], label: "Schedule button in Job Hour Details", section: "General" },
  { keys: ["build-readiness:view"], label: "Build Readiness", section: "General" },
  { keys: ["dashboard:view"], label: "Dashboard", section: "General" },
  { keys: ["tm:view"], label: "T&M", section: "General" },
  { keys: ["projects:view"], label: "Projects — View", section: "Projects" },
  { keys: ["projects:edit"], label: "Projects — Edit", section: "Projects" },
  { keys: ["monthly-etc:view"], label: "Monthly ETC", section: "Monthly ETC" },
  { keys: ["hours:view"], label: "Hours", section: "Hours" },
  { keys: ["standards:view", "standards:edit"], label: "Standard Fees", section: "Standards" },
  { keys: ["standards:pm"], label: "PM", section: "Standards", indent: true },
  { keys: ["standards:mfg"], label: "Mfg", section: "Standards", indent: true },
  { keys: ["standards:warranty"], label: "Warranty (Engineering + Shop)", section: "Standards", indent: true },
  { keys: ["profitability:view"], label: "Profitability / Job Cost Explorer", section: "Financial" },
  { keys: ["employees:view"], label: "Employees — View", section: "Administration" },
  { keys: ["employees:edit"], label: "Employees — Edit (Add Member)", section: "Administration" },
  { keys: ["employees:hiring:assign"], label: "Employees — Manage Hiring Positions (Create/Edit/Assign)", section: "Administration" },
  { keys: ["audit-log:view"], label: "Audit Log", section: "Administration" },
  { keys: ["users:manage"], label: "User Role Assignment", section: "Administration" },
  { keys: ["permissions:manage"], label: "Role Permissions (this page)", section: "Administration" },
] as const;
