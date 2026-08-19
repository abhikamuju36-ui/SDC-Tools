"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { HiringMoveToControl } from "@/components/HiringMoveToControl";
import { WORKFORCE_GROUPS, workforceGroupTitle, type WorkforceGroupKey } from "@/lib/employee-workforce-groups";
import { EMPLOYEE_TEAMS } from "@/lib/employee-teams";
import type { HiringPosition } from "@/lib/hiring-positions";

// Level 2 for the "Hiring Positions" card (2026-08-19) — every position
// (workbook + manually created), bucketed by its current workforce group
// (manual assignment if any, else the classifier's best-effort guess — see
// hiring-positions.ts), each row carrying the same Move-to control the
// detail drawer offers, so a manager scanning the whole list can reassign
// without opening each one. Never mixed into EmployeesCards' own employee
// list — the task's own "do not mix open positions into the actual employee
// list as if they are employees".
//
// (2026-08-19, Job Status filter): defaults to "Open positions" — the same
// scope this list always showed before closed positions started being kept
// around — with "All statuses" and each distinct raw status actually present
// (from EITHER source) also offered, so a Filled/Cancelled position stays
// findable without permanently cluttering the default view. This filter is
// local to this list only; it never affects the hiring/planned-headcount
// counts shown elsewhere, which always come from the full set filtered by
// `isOpen` (see WorkforceSummaryCards' caller in EmployeesGrid.tsx).

const DEPARTMENT_TITLE = new Map(EMPLOYEE_TEAMS.map((t) => [t.schedulerCode, t.name]));
const OPEN_FILTER = "__open__";
const ALL_FILTER = "__all__";

type Bucket = { key: WorkforceGroupKey | "unassigned"; title: string; positions: HiringPosition[] };

export function HiringPositionsList({
  positions,
  canAssign,
  canCreate,
  onSelect,
  onAssigned,
  onCreate,
}: {
  positions: HiringPosition[];
  canAssign: boolean;
  canCreate: boolean;
  onSelect: (position: HiringPosition) => void;
  onAssigned: (positionSourceId: string, next: { workforceGroup: WorkforceGroupKey | null; department: string | null }) => void;
  onCreate: () => void;
}) {
  const [statusFilter, setStatusFilter] = useState<string>(OPEN_FILTER);

  const distinctStatuses = useMemo(() => [...new Set(positions.map((p) => p.status))].filter(Boolean).sort(), [positions]);

  const filtered = useMemo(() => {
    if (statusFilter === OPEN_FILTER) return positions.filter((p) => p.isOpen);
    if (statusFilter === ALL_FILTER) return positions;
    return positions.filter((p) => p.status === statusFilter);
  }, [positions, statusFilter]);

  const buckets = useMemo<Bucket[]>(() => {
    const byGroup = new Map<WorkforceGroupKey | "unassigned", HiringPosition[]>();
    for (const p of filtered) {
      const key = p.workforceGroup ?? "unassigned";
      const list = byGroup.get(key);
      if (list) list.push(p);
      else byGroup.set(key, [p]);
    }
    const ordered: Bucket[] = WORKFORCE_GROUPS.filter((g) => g.key !== "other").map((g) => ({
      key: g.key,
      title: g.title,
      positions: byGroup.get(g.key) ?? [],
    }));
    const other = byGroup.get("other");
    if (other) ordered.push({ key: "other", title: workforceGroupTitle("other"), positions: other });
    ordered.push({ key: "unassigned", title: "Unassigned", positions: byGroup.get("unassigned") ?? [] });
    return ordered.filter((b) => b.positions.length > 0);
  }, [filtered]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by Job Status"
          className="h-8 rounded-lg border border-sdc-border bg-white px-2 text-xs text-sdc-navy outline-none focus:border-sdc-blue"
        >
          <option value={OPEN_FILTER}>Open positions</option>
          <option value={ALL_FILTER}>All statuses</option>
          {distinctStatuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {canCreate && (
          <button
            type="button"
            onClick={onCreate}
            className="h-8 rounded-lg bg-sdc-blue px-3 text-xs font-semibold text-white motion-interactive hover:brightness-95"
          >
            + Create Position
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No positions match" message="Try a different Job Status filter." />
      ) : (
        buckets.map((bucket) => (
          <section key={bucket.key} className="overflow-hidden rounded-xl border border-sdc-border bg-white shadow-sm">
            <header className="flex items-center justify-between gap-2 border-b border-sdc-border bg-sdc-gray-50 px-3.5 py-2">
              <h3 className="text-sm font-bold text-sdc-navy">{bucket.title}</h3>
              <span className="text-xs font-semibold tabular-nums text-sdc-muted">{bucket.positions.length}</span>
            </header>
            <ul className="divide-y divide-sdc-border-soft">
              {bucket.positions.map((p) => (
                <li key={p.sourceId} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
                  <button
                    type="button"
                    onClick={() => onSelect(p)}
                    className="min-w-0 flex-1 truncate text-left text-sm font-medium text-sdc-navy hover:text-sdc-blue hover:underline"
                    title={p.title}
                  >
                    {p.title}
                    {p.department && (
                      <span className="ml-2 truncate text-xs font-normal text-sdc-muted">{DEPARTMENT_TITLE.get(p.department)}</span>
                    )}
                    {!p.isOpen && (
                      <span className="ml-2 rounded bg-sdc-gray-100 px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide text-sdc-muted">
                        {p.status}
                      </span>
                    )}
                  </button>
                  {p.source === "workbook" ? (
                    <HiringMoveToControl
                      positionSourceId={p.sourceId}
                      workforceGroup={p.workforceGroup}
                      department={p.department}
                      canAssign={canAssign}
                      onAssigned={onAssigned}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelect(p)}
                      className="text-note font-medium text-sdc-blue hover:underline"
                      title="Edit this position"
                    >
                      Edit
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
