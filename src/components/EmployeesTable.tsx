"use client";

import { Fragment, useMemo, useState } from "react";
import { EMPLOYEE_TEAMS, OTHER_THEME, teamFor, type CardTheme } from "@/lib/employee-teams";
import { useColumnSort } from "@/components/useColumnSort";
import { SortableTh } from "@/components/ui/SortableHeader";
import { sortRows, type SortColumns } from "@/lib/table-sort";

// The employee roster, as one unified table grouped by department under
// collapsible section headers (2026-08-18, by request — replaces the earlier
// one-card-per-team grid). The card grid gave every team its own fixed-height
// box with its own internal scrollbar, which made comparing people ACROSS
// teams awkward (three separate scroll positions to keep track of) and wasted
// space on short teams. One table with one scroll fixes both: department
// still reads as a group (a colored header band, same team order/colors as
// before), but the page has exactly one scrollbar, and every column sorts.
//
// READ-ONLY. Name, discipline, supervisor and department all have upstream
// owners — discipline mirrors the SDC Scheduler's team_members, supervisors
// and the rest come from the Paylocity export — so an edit here is a local
// override the next sync may quietly undo. The roster is maintained through
// those imports and the toolbar's sync buttons instead.
export const DASH = "—"; // display value for "no discipline / no supervisor"

export type EmployeeRow = {
  id: number;
  name: string;
  discipline: string; // label or DASH
  // Job title (Employee_Department_Map.xlsx's own field — no other upstream
  // carries one) or DASH. Shown under "Role / Discipline", falling back to
  // discipline when there's no title on file, so the column is never blank
  // for someone who has at least ONE of the two.
  positionTitle: string;
  supervisor: string; // supervisor name or DASH
  department: string;
  // The shared team code (pm/mech/controls/build/wire/mfgops/service), now
  // the authoritative grouping — see teamFor() in employee-teams.ts.
  team: string | null;
  active: boolean;
  billingGroup: string;
  paylocityId: string;
};

const NO_DEPT = "No department"; // bucket for employees with no department AND no discipline

// Non-team departments that don't get their own section — "Operations" is a
// single-person administrative bucket, and "Unassigned" is a filing artifact
// (see teamFor() in employee-teams.ts) rather than a real place someone works.
// People here still count in the toolbar's totals and are still reachable via
// the department filter; they just don't get a section on the roster.
const HIDDEN_DEPARTMENT_CARDS = new Set(["operations", "unassigned"]);

type Group = {
  key: string;
  code: string | null; // short team code; null for a plain department
  title: string;
  theme: CardTheme;
  people: EmployeeRow[];
};

type SortKey = "name" | "department" | "role" | "supervisor" | "status";

// Role/Discipline sorts and displays the same value: title when there is one,
// discipline otherwise — one column, one truth about what it's showing.
const roleOf = (r: EmployeeRow) => (r.positionTitle !== DASH ? r.positionTitle : r.discipline);

const COLUMNS: SortColumns<EmployeeRow, SortKey> = {
  name: { type: "text", value: (r) => r.name },
  department: { type: "text", value: (r) => (r.department?.trim() ? r.department : DASH) },
  role: { type: "text", value: (r) => (roleOf(r) === DASH ? null : roleOf(r)) },
  supervisor: { type: "text", value: (r) => (r.supervisor === DASH ? null : r.supervisor) },
  // Active-first ascending reads naturally ("who's active" before "who left"), the
  // opposite of a plain string sort where "Active" < "Inactive" alphabetically
  // would coincidentally agree — spelled out so that agreement isn't an accident.
  status: { type: "text", value: (r) => (r.active ? "0-active" : "1-inactive") },
};

const TABLE_HEAD_H = "h-9"; // thead row height — the group header's sticky offset must match this exactly

function Chevron({ open }: { open: boolean }) {
  // Rotates rather than swapping glyph — same doctrine as ui/Drill.tsx's own
  // expand caret (drill-design.test.ts: "the caret rotates rather than
  // swapping glyph"), applied here for consistency though this table predates
  // that test's own file list.
  return (
    <svg
      viewBox="0 0 16 16"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden
      className={`shrink-0 motion-interactive ${open ? "rotate-90" : ""}`}
    >
      <path d="M6 3.5 L10.5 8 L6 12.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function EmployeesTable({ rows }: { rows: EmployeeRow[] }) {
  const sort = useColumnSort<SortKey>();
  // Collapsed-section keys. Empty by default — every section starts expanded,
  // matching the card grid's own "everyone visible at once" default.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    // Seeded with all seven teams in work order, so they hold their positions
    // rather than appearing in whatever order the rows happen to arrive.
    const byKey = new Map<string, Group>(
      EMPLOYEE_TEAMS.map((t) => [
        t.code,
        { key: t.code, code: t.code, title: t.name, theme: t.theme, people: [] as EmployeeRow[] },
      ]),
    );
    const extras: string[] = []; // non-team departments, in first-seen order

    for (const r of rows) {
      const team = teamFor(r);
      const key = team ? team.code : r.department?.trim() && r.department !== DASH ? r.department.trim() : NO_DEPT;
      if (!team && HIDDEN_DEPARTMENT_CARDS.has(key.toLowerCase())) continue;
      let group = byKey.get(key);
      if (!group) {
        group = { key, code: null, title: key, theme: OTHER_THEME, people: [] };
        byKey.set(key, group);
        extras.push(key);
      }
      group.people.push(r);
    }

    // Teams first, in work order; then everything else — real departments that
    // aren't delivery teams (Finance, Sales, Executive Leadership…) — A→Z, with
    // the no-department bucket last. Empty groups drop out, so a filtered view
    // doesn't leave seven headers with nothing under them.
    extras.sort((a, b) => (a === NO_DEPT ? 1 : b === NO_DEPT ? -1 : a.localeCompare(b)));
    return [...EMPLOYEE_TEAMS.map((t) => byKey.get(t.code)!), ...extras.map((k) => byKey.get(k)!)].filter(
      (g) => g.people.length > 0,
    );
  }, [rows]);

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const total = groups.reduce((s, g) => s + g.people.length, 0);

  if (total === 0) {
    return (
      <div className="rounded-xl border border-sdc-border bg-white px-4 py-10 text-center text-sm text-sdc-gray-400 shadow-sm">
        No employees match.
      </div>
    );
  }

  return (
    // One scroll surface — the page's own — for the whole table. No inner
    // overflow (x OR y) on this wrapper: `overflow-x-auto` alone is enough to
    // make a browser compute overflow-y as a non-visible value too (the CSS
    // overflow spec's own "the other axis becomes auto" rule), which turns
    // this div into ITS OWN scroll container and breaks `position: sticky`
    // below — a sticky element sticks against its nearest scrolling
    // ancestor, and that becomes this never-actually-scrolling div instead
    // of the page. Found live: the thead/group headers rendered but simply
    // scrolled away with everything else instead of sticking.
    <div className="rounded-xl border border-sdc-border bg-white shadow-sm">
      <table className="w-full border-collapse text-left">
        <thead className={`sticky top-0 z-20 ${TABLE_HEAD_H} bg-sdc-navy text-micro font-bold uppercase tracking-wider text-white`}>
          <tr>
            <SortableTh label="Employee" sortKey="name" type="text" sort={sort.sort} onSort={sort.onSort} className="px-3 py-2" />
            <SortableTh label="Department" sortKey="department" type="text" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
            <SortableTh label="Role / Discipline" sortKey="role" type="text" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
            <SortableTh label="Supervisor" sortKey="supervisor" type="text" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
            <SortableTh label="Status" sortKey="status" type="text" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const isOpen = !collapsed.has(g.key);
            const sorted = sortRows(g.people, sort.sort, COLUMNS);
            return (
              <Fragment key={g.key}>
                {/* The department color lives here and nowhere else — a band
                    on the group header, never smeared across every row
                    beneath it (the one thing that kept eight card colors
                    readable as a set stays true here too). Sticky just below
                    the table's own header, so it hands off to the NEXT
                    group's header as you scroll past, rather than either
                    disappearing or stacking. */}
                <tr>
                  <th
                    colSpan={5}
                    className={`sticky z-10 px-3 py-1.5 text-left ${g.theme.band} ${g.theme.onBand}`}
                    style={{ top: "2.25rem" /* TABLE_HEAD_H = h-9 = 2.25rem */ }}
                  >
                    <button type="button" onClick={() => toggle(g.key)} className="flex w-full items-center gap-2 text-left motion-interactive hover:opacity-90" aria-expanded={isOpen}>
                      <Chevron open={isOpen} />
                      {g.code && (
                        <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-label font-bold ${g.theme.chip}`}>{g.code}</span>
                      )}
                      <span className="truncate text-note font-bold tracking-wider uppercase">{g.title}</span>
                      <span className="ml-auto shrink-0 text-note font-semibold tabular-nums opacity-80">{g.people.length}</span>
                    </button>
                  </th>
                </tr>
                {isOpen &&
                  sorted.map((p, i) => (
                    <tr
                      key={p.id}
                      className={`text-note hover:bg-sdc-blue-light/40 ${i > 0 ? "border-t border-sdc-border-soft" : ""} ${p.active ? "" : "bg-sdc-gray-50/60"}`}
                      title={`${p.name} — ${roleOf(p) === DASH ? "no title/discipline on file" : roleOf(p)}, reports to ${p.supervisor}, ${p.department?.trim() || DASH}`}
                    >
                      <td className="px-3 py-1.5">
                        <span className={`font-medium ${p.active ? "text-sdc-navy" : "text-sdc-muted"}`}>{p.name}</span>
                      </td>
                      <td className="px-2 py-1.5 text-sdc-gray-600">{p.department?.trim() || DASH}</td>
                      <td className="px-2 py-1.5 text-sdc-muted">{roleOf(p)}</td>
                      <td className="px-2 py-1.5 text-sdc-gray-600">{p.supervisor}</td>
                      <td className="px-2 py-1.5">
                        <span className={`inline-flex items-center gap-1.5 ${p.active ? "text-sdc-green-text" : "text-sdc-muted"}`}>
                          <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${p.active ? "bg-sdc-green" : "bg-sdc-gray-300"}`} aria-hidden />
                          {p.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
