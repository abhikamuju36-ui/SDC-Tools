"use client";

import { Fragment, useState, useTransition } from "react";
import { PERMISSION_CATALOG, PERMISSION_SECTIONS, type PermissionCatalogEntry } from "@/lib/permission-catalog";
import { setRolePermissionAction } from "@/lib/role-permissions-actions";
import type { RolePermissionMatrixRow } from "@/lib/role-permissions-store";
import type { AppRole } from "@/lib/permissions";

type EditableRole = Exclude<AppRole, "ELT">;
const EDITABLE_ROLES: { role: EditableRole; label: string }[] = [
  { role: "ALL", label: "All" },
  { role: "MANAGER", label: "Managers" },
  { role: "SALES", label: "Sales" },
];
const RANK: Record<AppRole, number> = { ALL: 0, MANAGER: 1, SALES: 2, ELT: 3 };

function cellId(role: EditableRole, entry: PermissionCatalogEntry): string {
  return `${role}:${entry.keys.join(",")}`;
}

// The live, ELT-editable permission matrix. Every checkbox writes through
// setRolePermissionAction (a real Server Action — permissions:manage is
// re-checked there independently), which cascades the hierarchy on the
// SERVER (role-permissions-store.ts) and broadcasts to every connected
// session. This component re-derives its own local view of that cascade
// immediately after a successful save so the OTHER checkboxes in the same
// row visibly tick without waiting on the SSE round trip back to this same
// tab — the round trip still happens (see RealtimeProvider.tsx), it just
// isn't the only thing making this tab's own click feel instant.
export function RolePermissionsMatrix({ initialRows }: { initialRows: RolePermissionMatrixRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [pendingCells, setPendingCells] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const byKey = new Map(rows.map((r) => [r.permission, r]));

  function isChecked(entry: PermissionCatalogEntry, role: EditableRole): boolean {
    return entry.keys.every((k) => byKey.get(k)?.enabled[role] ?? false);
  }

  function toggle(entry: PermissionCatalogEntry, role: EditableRole, next: boolean) {
    const id = cellId(role, entry);
    setError(null);
    setPendingCells((prev) => new Set(prev).add(id));
    startTransition(async () => {
      try {
        for (const key of entry.keys) {
          const result = await setRolePermissionAction(role, key, next);
          if (!result.ok) {
            setError(result.error);
            return;
          }
        }
        // Apply the SAME cascade rule the server just applied — enabling
        // ticks this role and every role above it too; disabling clears
        // this role and every role at or below it — so the row reflects the
        // real saved state, not just the one box clicked.
        setRows((prev) => {
          const byKeyNext = new Map(prev.map((r) => [r.permission, { ...r, enabled: { ...r.enabled } }]));
          for (const key of entry.keys) {
            const row = byKeyNext.get(key) ?? { permission: key, enabled: { ALL: false, MANAGER: false, SALES: false } };
            for (const { role: r } of EDITABLE_ROLES) {
              if (next ? RANK[r] >= RANK[role] : RANK[r] <= RANK[role]) row.enabled[r] = next;
            }
            byKeyNext.set(key, row);
          }
          return [...byKeyNext.values()];
        });
      } finally {
        setPendingCells((prev) => {
          const next2 = new Set(prev);
          next2.delete(id);
          return next2;
        });
      }
    });
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-sdc-border bg-white shadow-sm">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-sdc-navy text-label font-bold uppercase tracking-wide text-white">
          <tr>
            <th className="px-4 py-2.5 text-left">Permission</th>
            {EDITABLE_ROLES.map(({ role, label }) => (
              <th key={role} className="px-3 py-2.5 text-center">
                {label}
              </th>
            ))}
            <th className="px-3 py-2.5 text-center">ELT</th>
          </tr>
        </thead>
        <tbody>
          {PERMISSION_SECTIONS.map((section) => {
            const entries = PERMISSION_CATALOG.filter((e) => e.section === section);
            if (entries.length === 0) return null;
            return (
              <Fragment key={section}>
                <tr className="bg-sdc-gray-50">
                  <td colSpan={5} className="px-4 py-1.5 text-label font-bold uppercase tracking-wide text-sdc-muted">
                    {section}
                  </td>
                </tr>
                {entries.map((entry) => (
                  <tr key={entry.keys.join(",")} className="border-t border-sdc-border/60">
                    <td className={`px-4 py-2 ${entry.indent ? "pl-8 text-sdc-gray-600" : "font-medium text-sdc-navy"}`}>{entry.label}</td>
                    {EDITABLE_ROLES.map(({ role }) => (
                      <td key={role} className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked(entry, role)}
                          disabled={pendingCells.has(cellId(role, entry))}
                          onChange={(e) => toggle(entry, role, e.target.checked)}
                          className="h-4 w-4 accent-sdc-blue disabled:opacity-50"
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked
                        disabled
                        title="ELT always has full access — this can't be turned off here."
                        className="h-4 w-4 accent-sdc-blue opacity-60"
                      />
                    </td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
          <tr className="border-t border-sdc-border/60 bg-sdc-gray-50/60">
            <td className="px-4 py-2 italic text-sdc-muted" colSpan={4}>
              Anything added later that isn&apos;t listed above
            </td>
            <td className="px-3 py-2 text-center">
              <input
                type="checkbox"
                checked
                disabled
                title="Any future permission not yet listed here is ELT-only, automatically."
                className="h-4 w-4 accent-sdc-blue opacity-60"
              />
            </td>
          </tr>
        </tbody>
      </table>
      {error && <p className="border-t border-sdc-border px-4 py-2 text-sm text-sdc-red-text">{error}</p>}
    </div>
  );
}
