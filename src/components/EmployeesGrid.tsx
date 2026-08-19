"use client";

import { useMemo, useState } from "react";
import { EmployeesCards } from "@/components/EmployeesCards";
import { WorkforceSummaryCards } from "@/components/WorkforceSummaryCards";
import { EmployeeDetailDrawer } from "@/components/EmployeeDetailDrawer";
import { HiringPositionsList } from "@/components/HiringPositionsList";
import { HiringPositionDetailDrawer } from "@/components/HiringPositionDetailDrawer";
import { CreateHiringPositionDrawer } from "@/components/CreateHiringPositionDrawer";
import { DASH, type EmployeeRow } from "@/lib/employee-row";
import { resolveEmployeeGroup } from "@/lib/employee-card-theme";
import { resolvePlaceholderGroup, type DepartmentCard } from "@/lib/employee-department-cards";
import { workforceGroupForCardKey, workforceGroupTitle, type WorkforceGroupKey } from "@/lib/employee-workforce-groups";
import type { SchedulerPlaceholder } from "@/lib/scheduler-db";
import type { HiringPosition } from "@/lib/hiring-positions";
import { MenuBulkActions, MenuCheckbox } from "@/components/MenuStatus";

// Toolbar + filtering + drill-down navigation for the employee roster;
// WorkforceSummaryCards/EmployeesCards/HiringPositionsList render the actual
// cards/lists.
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

// The page-level "Employees > Engineering > Mechanical Engineering" (or
// "Employees > Hiring Positions") trail (2026-08-19) — separate from
// EmployeeDetailDrawer/HiringPositionDetailDrawer's own breadcrumb prop,
// which is each DRAWER's internal one-entry title bar, not this page nav.
// Every segment but the last is a real button (jump back to that level); the
// last is the current level, bold and non-interactive — same convention
// BuildReadinessDrawer's own breadcrumb already uses.
function DrillBreadcrumb({
  trail,
  onJump,
}: {
  /** Root ("Employees") is implicit and always first; this is everything AFTER it. */
  trail: string[];
  onJump: (index: number) => void;
}) {
  const segments = ["Employees", ...trail];
  return (
    <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-sm">
      {segments.map((label, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && (
            <span className="text-sdc-gray-300" aria-hidden>
              /
            </span>
          )}
          {i === segments.length - 1 ? (
            <span className="font-semibold text-sdc-navy">{label}</span>
          ) : (
            <button type="button" onClick={() => onJump(i)} className="font-medium text-sdc-blue hover:underline">
              {label}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}

// `disciplines` drives the toolbar filter only. The table itself is read-only,
// so it no longer needs the discipline or supervisor option lists that used to
// populate its in-cell dropdowns.
export function EmployeesGrid({
  rows,
  disciplines,
  placeholders,
  canAddEmployees,
  hiringPositions,
  hiringError,
  canAssignHiring,
}: {
  rows: EmployeeRow[];
  disciplines: string[];
  placeholders: SchedulerPlaceholder[];
  canAddEmployees: boolean;
  hiringPositions: HiringPosition[];
  hiringError: string | null;
  canAssignHiring: boolean;
}) {
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [discipline, setDiscipline] = useState("");
  const [dept, setDept] = useState<string[]>([]);

  // ── Drill-down navigation (2026-08-19) — Employees > workforce group >
  // department, OR Employees > Hiring Positions; the two detail drawers are
  // independent overlay state, since they're overlays rather than navigation
  // levels (closing one returns to whatever level/filters were already
  // showing underneath). All of this lives in THIS component, alongside the
  // filter state above, precisely so drilling in/out and opening/closing a
  // drawer never resets a filter — there is nothing here that unmounts on
  // navigation, only state that changes.
  const [group, setGroup] = useState<WorkforceGroupKey | null>(null);
  const [departmentKey, setDepartmentKey] = useState<string | null>(null);
  const [departmentTitle, setDepartmentTitle] = useState<string | null>(null);
  const [showHiring, setShowHiring] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeRow | null>(null);
  const [selectedHiringPosition, setSelectedHiringPosition] = useState<HiringPosition | null>(null);
  const [creatingHiringPosition, setCreatingHiringPosition] = useState(false);

  // Local, optimistically-updated copy of the server-loaded positions — a
  // successful assign/create/update (hiring-actions.ts) updates this
  // immediately rather than waiting on a full page reload, the same "apply
  // what the server action returned, don't guess" spirit as everywhere else
  // in this app that updates client state from a server action's result.
  // Includes BOTH open and closed positions now (2026-08-19, Job Status) —
  // `openHiring` below is the one place that narrows back down to what
  // should count toward hiring/planned-headcount totals.
  const [hiring, setHiring] = useState(hiringPositions);

  function applyAssignment(positionSourceId: string, next: { workforceGroup: WorkforceGroupKey | null; department: string | null }) {
    setHiring((prev) =>
      prev.map((p) => (p.sourceId === positionSourceId ? { ...p, workforceGroup: next.workforceGroup, department: next.department, isManuallyAssigned: true } : p)),
    );
    setSelectedHiringPosition((prev) =>
      prev && prev.sourceId === positionSourceId ? { ...prev, workforceGroup: next.workforceGroup, department: next.department, isManuallyAssigned: true } : prev,
    );
  }

  function applyHiringUpdate(positionSourceId: string, patch: Partial<HiringPosition>) {
    setHiring((prev) => prev.map((p) => (p.sourceId === positionSourceId ? { ...p, ...patch } : p)));
    setSelectedHiringPosition((prev) => (prev && prev.sourceId === positionSourceId ? { ...prev, ...patch } : prev));
  }

  function applyHiringCreate(position: HiringPosition) {
    setHiring((prev) => [position, ...prev]);
  }

  // Always OPEN positions only — the input WorkforceSummaryCards/EmployeesCards'
  // hiring-count formulas expect (see WorkforceSummaryCards' own "Already OPEN
  // positions only" comment). A closed/filled position (from either source)
  // never inflates a count, regardless of what HiringPositionsList's own Job
  // Status filter is currently showing.
  const openHiring = useMemo(() => hiring.filter((p) => p.isOpen), [hiring]);

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

  // Existing search/discipline/department/show-inactive filters apply FIRST
  // (`visible`, unchanged from before this feature) — drilling into a
  // workforce group or department narrows what's already been filtered, so
  // e.g. picking "Mechanical Engineering" in the Department filter already
  // shrinks Engineering's own Level 1 numbers to just that one department,
  // exactly as the task's own example asks for, with no special-casing here.
  const scopedRows = useMemo(() => {
    if (!group) return visible;
    return visible.filter((r) => {
      const card = resolveEmployeeGroup(r);
      if (!card) return false;
      if (departmentKey) return card.key === departmentKey;
      return workforceGroupForCardKey(card.key) === group;
    });
  }, [visible, group, departmentKey]);

  // Placeholders aren't employees, so the toolbar's filters never apply to
  // them — but the DRILL scope still must, or a Shop placeholder would leak
  // into an Engineering-only view as its own out-of-place card (EmployeesCards
  // creates a card for ANY placeholder it's handed, with no idea what scope
  // the caller intends).
  const scopedPlaceholders = useMemo(() => {
    if (!group) return placeholders;
    return placeholders.filter((p) => {
      const card = resolvePlaceholderGroup(p);
      if (!card) return false;
      if (departmentKey) return card.key === departmentKey;
      return workforceGroupForCardKey(card.key) === group;
    });
  }, [placeholders, group, departmentKey]);

  // Same scoping rule applied to hiring positions, so Engineering's Level 2
  // view shows only Engineering's own open positions, not the whole company's.
  const scopedHiring = useMemo(() => {
    if (!group) return [];
    return openHiring.filter((p) => (departmentKey ? p.department === departmentKey : p.workforceGroup === group));
  }, [openHiring, group, departmentKey]);

  function openGroup(key: WorkforceGroupKey) {
    setShowHiring(false);
    setGroup(key);
    setDepartmentKey(null);
    setDepartmentTitle(null);
  }

  function openDepartment(groupKey: WorkforceGroupKey, card: DepartmentCard) {
    setShowHiring(false);
    setGroup(groupKey);
    setDepartmentKey(card.key);
    setDepartmentTitle(card.title);
  }

  function openHiringView() {
    setGroup(null);
    setDepartmentKey(null);
    setDepartmentTitle(null);
    setShowHiring(true);
  }

  function backToRoot() {
    setGroup(null);
    setDepartmentKey(null);
    setDepartmentTitle(null);
    setShowHiring(false);
  }

  function backToGroup() {
    setDepartmentKey(null);
    setDepartmentTitle(null);
  }

  function selectEmployee(row: EmployeeRow) {
    setSelectedHiringPosition(null);
    setSelectedEmployee(row);
  }

  function selectHiringPosition(position: HiringPosition) {
    setSelectedEmployee(null);
    setSelectedHiringPosition(position);
  }

  const selectedEmployeeGroup = selectedEmployee ? resolveEmployeeGroup(selectedEmployee) : null;

  const breadcrumbTrail = showHiring ? ["Hiring Positions"] : group ? (departmentTitle ? [workforceGroupTitle(group), departmentTitle] : [workforceGroupTitle(group)]) : [];

  function jumpTo(index: number) {
    if (index === 0) {
      backToRoot();
    } else if (index === 1 && group) {
      backToGroup();
    }
  }

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

      {breadcrumbTrail.length > 0 && <DrillBreadcrumb trail={breadcrumbTrail} onJump={jumpTo} />}

      {hiringError && (
        <p className="mb-3 rounded border border-sdc-yellow bg-sdc-yellow-bg px-2 py-1 text-note text-sdc-yellow-text">
          Couldn&apos;t read the hiring positions workbook: {hiringError}
        </p>
      )}

      {showHiring ? (
        <HiringPositionsList
          positions={hiring}
          canAssign={canAssignHiring}
          canCreate={canAssignHiring}
          onSelect={selectHiringPosition}
          onAssigned={applyAssignment}
          onCreate={() => setCreatingHiringPosition(true)}
        />
      ) : !group ? (
        <WorkforceSummaryCards
          rows={visible}
          placeholders={placeholders}
          hiringPositions={openHiring}
          onSelectGroup={openGroup}
          onSelectDepartment={openDepartment}
          onSelectHiring={openHiringView}
        />
      ) : (
        <EmployeesCards
          rows={scopedRows}
          placeholders={scopedPlaceholders}
          canAddEmployees={canAddEmployees}
          onSelectEmployee={selectEmployee}
          onSelectDepartment={departmentKey ? undefined : (card) => openDepartment(group, card)}
          hiringPositions={scopedHiring}
          onSelectHiringPosition={selectHiringPosition}
        />
      )}

      {selectedEmployee && (
        <EmployeeDetailDrawer
          employee={selectedEmployee}
          departmentTitle={selectedEmployeeGroup?.title ?? selectedEmployee.department?.trim() ?? DASH}
          workforceGroup={workforceGroupForCardKey(selectedEmployeeGroup?.key ?? "")}
          onClose={() => setSelectedEmployee(null)}
        />
      )}

      {selectedHiringPosition && (
        <HiringPositionDetailDrawer
          position={selectedHiringPosition}
          canAssign={canAssignHiring}
          onAssigned={applyAssignment}
          onUpdated={applyHiringUpdate}
          onClose={() => setSelectedHiringPosition(null)}
        />
      )}

      {creatingHiringPosition && (
        <CreateHiringPositionDrawer onClose={() => setCreatingHiringPosition(false)} onCreated={applyHiringCreate} />
      )}
    </>
  );
}
