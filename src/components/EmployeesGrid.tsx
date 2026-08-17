"use client";

import { useMemo, useState } from "react";
import { EmployeesTable, DASH, type EmployeeRow } from "@/components/EmployeesTable";
import { MenuBulkActions, MenuCheckbox } from "@/components/MenuStatus";

// Toolbar + filtering for the employee roster; EmployeesTable renders the grid.
//
// The Discipline and Dept dropdowns used to be a floating-filter row inside AG
// Grid, directly under the column headers. They live here now, next to the
// search box that was always in the toolbar anyway — one row of controls instead
// of two, and the table's header row goes back to being just headers.
const SELECT =
  "h-8 rounded-lg border border-sdc-border bg-white px-2 text-xs text-sdc-navy outline-none focus:border-sdc-blue";

// Department needs multiple-at-once (by request, 2026-08-18 — comparing two
// or three departments side by side in the unified table), unlike Discipline,
// which stays a plain single-value <select>. Plain client state, not the
// URL-param-driven pattern HoursFilterMenu/ProjectsFilterMenu use — this
// whole page is already an in-memory filter over a fully-loaded roster with
// no server round-trip to save, so a second, heavier apparatus would buy
// nothing. Reuses MenuCheckbox/MenuBulkActions (MenuStatus.tsx) since those
// are already plain presentational pieces, not tied to that URL-draft hook.
function DepartmentMenu({
  options,
  selected,
  onChange,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = selected.length === 0 ? "All departments" : selected.length === 1 ? selected[0] : `${selected.length} departments`;
  const toggle = (d: string) => onChange(selected.includes(d) ? selected.filter((x) => x !== d) : [...selected, d]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`${SELECT} inline-flex max-w-48 items-center gap-1.5 truncate`}
      >
        <span className="truncate">{label}</span>
        <svg viewBox="0 0 16 16" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2" className={`shrink-0 opacity-60 motion-interactive ${open ? "rotate-180" : ""}`}>
          <path d="M3.5 6 L8 10.5 L12.5 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <>
          {/* Click-outside to close — a transparent full-screen layer under the panel. */}
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="motion-menu-panel styled-scrollbar absolute left-0 top-full z-30 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-sdc-border bg-white p-2 shadow-lg">
            <MenuBulkActions onAll={() => onChange(options)} onNone={() => onChange([])} />
            {options.map((d) => (
              <MenuCheckbox key={d} label={d} checked={selected.includes(d)} onChange={() => toggle(d)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// `disciplines` drives the toolbar filter only. The table itself is read-only,
// so it no longer needs the discipline or supervisor option lists that used to
// populate its in-cell dropdowns.
export function EmployeesGrid({
  rows,
  disciplines,
}: {
  rows: EmployeeRow[];
  disciplines: string[];
}) {
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [discipline, setDiscipline] = useState("");
  const [dept, setDept] = useState<string[]>([]);

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
      if (dept.length > 0 && !dept.includes(r.department?.trim() ?? "")) return false;
      if (!s) return true;
      // Same fields the old grid's quick filter covered.
      return [r.name, r.discipline, r.positionTitle, r.supervisor, r.department].some((v) =>
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
        [r.name, r.discipline, r.positionTitle, r.supervisor, r.department].some((v) => String(v ?? "").toLowerCase().includes(s)),
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
        <DepartmentMenu options={departments} selected={dept} onChange={setDept} />
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
      <EmployeesTable rows={visible} />
    </>
  );
}
