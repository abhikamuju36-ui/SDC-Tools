"use client";

import { useMemo, useState } from "react";
import { EmployeesTable, DASH, type EmployeeRow } from "@/components/EmployeesTable";

// Toolbar + filtering for the employee roster; EmployeesTable renders the grid.
//
// The Discipline and Dept dropdowns used to be a floating-filter row inside AG
// Grid, directly under the column headers. They live here now, next to the
// search box that was always in the toolbar anyway — one row of controls instead
// of two, and the table's header row goes back to being just headers.
const SELECT =
  "h-8 rounded-lg border border-sdc-border bg-white px-2 text-xs text-sdc-navy outline-none focus:border-sdc-blue";

export function EmployeesGrid({
  rows,
  disciplines,
  supervisors,
}: {
  rows: EmployeeRow[];
  disciplines: string[];
  supervisors: { id: number; name: string }[];
}) {
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [discipline, setDiscipline] = useState("");
  const [dept, setDept] = useState("");

  // Departments actually present in the data, so the dropdown can't offer a
  // value that would filter to nothing.
  const departments = useMemo(
    () => [...new Set(rows.map((r) => r.department?.trim()).filter((d): d is string => !!d && d !== DASH))].sort(),
    [rows],
  );

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showInactive && !r.active) return false;
      if (discipline && r.discipline !== discipline) return false;
      if (dept && r.department?.trim() !== dept) return false;
      if (!s) return true;
      // Same fields the old grid's quick filter covered.
      return [r.name, r.discipline, r.supervisor, r.department].some((v) =>
        String(v ?? "").toLowerCase().includes(s),
      );
    });
  }, [rows, q, showInactive, discipline, dept]);

  const activeCount = rows.filter((r) => r.active).length;

  // While searching with inactive hidden, count how many INACTIVE people match
  // so we can offer to reveal them — otherwise a departed employee is
  // unfindable (search only filters the visible/active rows) and reactivation,
  // the whole point of soft-delete, is hard to discover.
  const hiddenInactiveMatches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || showInactive) return 0;
    return rows.filter(
      (r) =>
        !r.active &&
        [r.name, r.discipline, r.supervisor, r.department].some((v) => String(v ?? "").toLowerCase().includes(s)),
    ).length;
  }, [rows, q, showInactive]);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5 rounded-lg border border-sdc-border bg-white px-3.5">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sdc-gray-400">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="w-56 border-none bg-transparent py-2 text-sm text-sdc-navy outline-none placeholder:text-sdc-gray-400"
          />
        </div>
        <select value={discipline} onChange={(e) => setDiscipline(e.target.value)} aria-label="Filter by discipline" className={SELECT}>
          <option value="">All disciplines</option>
          {disciplines.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Filter by department" className={SELECT}>
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs font-medium text-sdc-gray-600">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-3.5 w-3.5" />
          Show inactive
        </label>
        <span className="text-xs text-sdc-gray-400">
          {activeCount} active{showInactive ? ` · ${rows.length - activeCount} inactive` : ""}
          {/* Shown only when a filter is narrowing things, so the count doesn't
              contradict the roster total on an unfiltered view. */}
          {visible.length !== (showInactive ? rows.length : activeCount) ? ` · ${visible.length} shown` : ""}
        </span>
        {hiddenInactiveMatches > 0 && (
          <button
            type="button"
            onClick={() => setShowInactive(true)}
            className="text-xs font-medium text-sdc-blue hover:underline"
          >
            {hiddenInactiveMatches} inactive {hiddenInactiveMatches === 1 ? "person matches" : "people match"} — show them
          </button>
        )}
      </div>
      <EmployeesTable rows={visible} disciplines={disciplines} supervisors={supervisors} />
    </>
  );
}
