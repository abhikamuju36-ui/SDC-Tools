"use client";

import { Fragment, useMemo, useState } from "react";
import { card, INPUT, TABLE_ROW_HOVER } from "@/components/ui/classnames";
import { SectionTitle } from "@/components/ui/Typography";
import { SortableTh } from "@/components/ui/SortableHeader";
import { cycleSortState, sortRows, type SortColumns, type SortState } from "@/lib/table-sort";
import type {
  DepartmentUtilizationResult,
  DepartmentUtilizationRow,
  UtilizationMeasures,
} from "@/lib/department-utilization";

// ── Department / Employee Utilization, the Dashboard's section ──────────────
//
// Presentational only. Every figure arrives already computed from
// lib/department-utilization.ts through getDashboardOverview's single pass —
// there is no business rule in this file, and nothing here fetches anything.
// A client component purely because the two views are interactive (sort, expand,
// department filter, employee search); the data is handed in as a prop.
//
// The layout is deliberately NOT the Power BI matrix it replaces. That visual put
// fifteen numeric columns and a nested three-level row hierarchy in one grid, which
// is why it needs a full screen and still crowds. Here:
//
//   - the department table keeps all fifteen measures but scrolls HORIZONTALLY in
//     its own container, so a narrow screen never pushes the whole Dashboard
//     sideways (the six columns that answer "how are we doing" are the ones inside
//     the initial viewport; the billable breakdown follows to the right);
//   - the row hierarchy collapses from three levels to two — department, expand for
//     its people — because the middle level (billing group) is one repeated word
//     per row and is better as a column;
//   - the employee view is its own ranked bar list rather than a second matrix.

const pctFmt = (n: number | null): string => (n === null ? "—" : `${Math.round(n * 100)}%`);
const hoursFmt = (n: number | null): string =>
  n === null ? "—" : n === 0 ? "0" : n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * Utilization bar colour. Deliberately a THREE-stop scale with a neutral middle,
 * not a red/green pass-fail: utilization is a business ratio somebody has to
 * interpret, and painting 89% red implies a threshold nobody has agreed to. Red is
 * reserved for the genuinely wrong-looking end of the range.
 */
function utilTone(pct: number | null): { bar: string; text: string } {
  if (pct === null) return { bar: "bg-sdc-gray-400", text: "text-sdc-muted" };
  if (pct >= 0.9) return { bar: "bg-sdc-green", text: "text-sdc-green-text" };
  if (pct >= 0.7) return { bar: "bg-sdc-blue", text: "text-sdc-blue-dark" };
  return { bar: "bg-sdc-red", text: "text-sdc-red-text" };
}

type DeptSortKey =
  | "title" | "billingGroup" | "employees" | "theoreticalHours" | "actualHours" | "availablePct"
  | "utilizationPct" | "billableTotal" | "billableActive" | "warranty" | "billableService"
  | "billableSpareParts" | "bellco" | "nonBillable" | "travelHours" | "travelPct" | "overtimeHours";

const DEPT_COLUMNS: SortColumns<DepartmentUtilizationRow, DeptSortKey> = {
  title: { type: "text", value: (r) => r.title },
  billingGroup: { type: "text", value: (r) => r.billingGroup },
  employees: { type: "number", value: (r) => r.employees },
  theoreticalHours: { type: "hours", value: (r) => r.theoreticalHours },
  actualHours: { type: "hours", value: (r) => r.actualHours },
  availablePct: { type: "number", value: (r) => r.availablePct },
  utilizationPct: { type: "number", value: (r) => r.utilizationPct },
  billableTotal: { type: "hours", value: (r) => r.billableTotal },
  billableActive: { type: "hours", value: (r) => r.billableActive },
  warranty: { type: "hours", value: (r) => r.warranty },
  billableService: { type: "hours", value: (r) => r.billableService },
  billableSpareParts: { type: "hours", value: (r) => r.billableSpareParts },
  bellco: { type: "hours", value: (r) => r.bellco },
  nonBillable: { type: "hours", value: (r) => r.nonBillable },
  travelHours: { type: "hours", value: (r) => r.travelHours },
  travelPct: { type: "number", value: (r) => r.travelPct },
  overtimeHours: { type: "hours", value: (r) => r.overtimeHours },
};

// label, key, and whether the column is part of the "core" block that must be
// visible before any horizontal scrolling.
const DEPT_HEADERS: { key: DeptSortKey; label: string; core?: boolean }[] = [
  { key: "employees", label: "Employees", core: true },
  { key: "theoreticalHours", label: "Theoretical", core: true },
  { key: "actualHours", label: "Actual", core: true },
  { key: "availablePct", label: "Available %", core: true },
  { key: "utilizationPct", label: "Utilization %", core: true },
  { key: "billableTotal", label: "Billable" },
  { key: "billableActive", label: "Active" },
  { key: "warranty", label: "Warranty" },
  { key: "billableService", label: "Service" },
  { key: "billableSpareParts", label: "Spare Parts" },
  { key: "bellco", label: "Bellco" },
  { key: "nonBillable", label: "Non-Billable" },
  { key: "travelHours", label: "Travel" },
  { key: "travelPct", label: "Travel %" },
  { key: "overtimeHours", label: "Overtime" },
];

// The frozen first column. One token, because the header, the department rows,
// the employee sub-rows and the total row must agree on width to the pixel or the
// sticky column visibly steps as you scroll sideways.
//
// It deliberately carries NO background: every use site supplies its own, and that
// background MUST BE OPAQUE. A sticky cell is painted over the scrolling content
// beneath it, so `bg-inherit` (which resolves to transparent on a row with no
// background of its own) or any `/30`-style translucent tint lets the numeric
// columns slide visibly through the department names. That is exactly what
// happened here before the row backgrounds below were made solid.
const DEPT_CELL = "sticky left-0 z-10 w-[17rem] min-w-[17rem] max-w-[17rem] whitespace-nowrap";

/** The Utilization % cell — the number the section exists for, so it carries the bar. */
function UtilCell({ pct, muted }: { pct: number | null; muted?: boolean }) {
  const tone = utilTone(pct);
  if (pct === null) {
    return (
      <span className="text-sdc-muted" title="Utilization % is only defined for the billable delivery departments">
        —
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-sdc-gray-100" aria-hidden>
        <span className={`block h-full rounded-full ${tone.bar}`} style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </span>
      <span className={`tabular-nums font-semibold ${muted ? "text-sdc-muted" : tone.text}`}>{pctFmt(pct)}</span>
    </span>
  );
}

function DepartmentTable({ result }: { result: DepartmentUtilizationResult }) {
  const [sort, setSort] = useState<SortState<DeptSortKey>>({ key: "utilizationPct", direction: "desc" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const rows = useMemo(() => sortRows(result.departments, sort, DEPT_COLUMNS), [result.departments, sort]);
  const onSort = (k: DeptSortKey) => setSort((s) => cycleSortState(s, k));

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const numeric = (row: UtilizationMeasures, key: DeptSortKey) => {
    switch (key) {
      case "employees": return String(row.employees);
      case "availablePct": return pctFmt(row.availablePct);
      case "travelPct": return pctFmt(row.travelPct);
      case "travelHours": return hoursFmt(row.travelHours);
      case "theoreticalHours": return hoursFmt(row.theoreticalHours);
      case "actualHours": return hoursFmt(row.actualHours);
      case "billableTotal": return hoursFmt(row.billableTotal);
      case "billableActive": return hoursFmt(row.billableActive);
      case "warranty": return hoursFmt(row.warranty);
      case "billableService": return hoursFmt(row.billableService);
      case "billableSpareParts": return hoursFmt(row.billableSpareParts);
      case "bellco": return hoursFmt(row.bellco);
      case "nonBillable": return hoursFmt(row.nonBillable);
      case "overtimeHours": return hoursFmt(row.overtimeHours);
      default: return "";
    }
  };

  return (
    // The scroller, not the page, takes the overflow — a fifteen-column table must
    // never make the whole Dashboard scroll sideways on a laptop.
    <div className="overflow-x-auto">
      <table className="w-full min-w-[62rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-sdc-border bg-white text-xs uppercase tracking-wide text-sdc-muted">
            <SortableTh
              label="Department"
              sortKey="title"
              type="text"
              sort={sort}
              onSort={onSort}
              className={`${DEPT_CELL} bg-white py-2 pl-3 pr-3 font-semibold`}
            />
            {DEPT_HEADERS.map((h) => (
              <SortableTh
                key={h.key}
                label={h.label}
                sortKey={h.key}
                type={h.key.endsWith("Pct") || h.key === "employees" ? "number" : "hours"}
                sort={sort}
                onSort={onSort}
                className="py-2 px-2 font-semibold whitespace-nowrap"
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const open = expanded.has(row.key);
            return (
              // Fragment (not the <tr>) carries the key: one department renders a
              // row PLUS its expanded employee rows, so the list item is the pair.
              <Fragment key={row.key}>
                <tr className={`border-b border-sdc-border-soft ${TABLE_ROW_HOVER} ${open ? "bg-sdc-blue-light" : "bg-white"}`}>
                  <th scope="row" className={`${DEPT_CELL} ${open ? "bg-sdc-blue-light" : "bg-white"} py-1.5 pl-3 pr-3 text-left font-normal`}>
                    <button
                      type="button"
                      onClick={() => toggle(row.key)}
                      aria-expanded={open}
                      title={
                        row.inUtilizationScope
                          ? undefined
                          : "Outside the billable delivery departments — hours are shown, Utilization % is not"
                      }
                      className="flex w-full items-center gap-1.5 text-left hover:underline"
                    >
                      <span
                        className={`inline-block shrink-0 text-[0.6rem] text-sdc-muted motion-interactive ${open ? "rotate-90" : ""}`}
                        aria-hidden
                      >
                        ▶
                      </span>
                      {/* Non-scope departments are muted rather than badged. The "—" this
                          row already shows under Utilization % says the same thing, and a
                          pill here was wrapping the longer names onto three lines and
                          making every row a different height. */}
                      <span className={`shrink-0 font-medium ${row.inUtilizationScope ? "text-sdc-navy" : "text-sdc-gray-600"}`}>
                        {row.title}
                      </span>
                      {row.billingGroup !== row.title && (
                        <span className="ml-auto min-w-0 truncate pl-2 text-xs text-sdc-muted">{row.billingGroup}</span>
                      )}
                    </button>
                  </th>
                  {DEPT_HEADERS.map((h) => (
                    <td key={h.key} className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">
                      {h.key === "utilizationPct" ? <UtilCell pct={row.utilizationPct} /> : numeric(row, h.key)}
                    </td>
                  ))}
                </tr>
                {open &&
                  row.employeeRows.map((e) => (
                    <tr key={`${row.key}::${e.employeeId}`} className="border-b border-sdc-border-soft bg-sdc-gray-50 text-xs">
                      <th scope="row" className={`${DEPT_CELL} bg-sdc-gray-50 py-1 pl-9 pr-3 text-left font-normal text-sdc-gray-700`}>
                        {e.name}
                        {!e.active && (
                          <span
                            className="ml-1.5 rounded bg-sdc-yellow-bg px-1 py-0.5 text-[0.6rem] font-semibold uppercase text-sdc-yellow-text"
                            title="No longer active, but booked hours in this month — see department-utilization.ts"
                          >
                            Left
                          </span>
                        )}
                      </th>
                      {DEPT_HEADERS.map((h) => (
                        <td key={h.key} className="py-1 px-2 text-right tabular-nums whitespace-nowrap text-sdc-gray-700">
                          {h.key === "employees" ? "" : h.key === "utilizationPct" ? <UtilCell pct={e.utilizationPct} muted /> : numeric(e, h.key)}
                        </td>
                      ))}
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-sdc-border bg-white font-semibold text-sdc-navy">
            <th scope="row" className={`${DEPT_CELL} bg-white py-2 pl-3 pr-3 text-left`}>
              Total
              <span className="ml-1.5 text-xs font-normal text-sdc-muted">billable departments</span>
            </th>
            {DEPT_HEADERS.map((h) => (
              <td key={h.key} className="py-2 px-2 text-right tabular-nums whitespace-nowrap">
                {h.key === "utilizationPct" ? <UtilCell pct={result.total.utilizationPct} /> : numeric(result.total, h.key)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

type EmpSort = "utilAsc" | "utilDesc" | "hours" | "name";

function EmployeeUtilization({ result }: { result: DepartmentUtilizationResult }) {
  const [dept, setDept] = useState<string>("__scope__");
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<EmpSort>("utilAsc");

  const departments = useMemo(
    () => result.departments.filter((d) => d.employeeRows.length > 0).map((d) => ({ key: d.key, title: d.title })),
    [result.departments],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = result.employees.filter((e) => {
      if (dept === "__scope__") {
        // The default view answers the same question the report's "Bottom 10" does:
        // who among the billable departments is running low. Somebody with no hours
        // at all has no utilization to rank, so they are not in it.
        if (!e.inUtilizationScope || e.actualHours <= 0) return false;
      } else if (dept !== "__all__" && e.departmentKey !== dept) return false;
      if (q && !e.name.toLowerCase().includes(q)) return false;
      return true;
    });
    list = [...list];
    switch (order) {
      case "utilAsc":
        // Nulls last in both directions — an undefined ratio is not "the lowest".
        list.sort((a, b) => (a.utilizationPct ?? Infinity) - (b.utilizationPct ?? Infinity) || a.name.localeCompare(b.name));
        break;
      case "utilDesc":
        list.sort((a, b) => (b.utilizationPct ?? -Infinity) - (a.utilizationPct ?? -Infinity) || a.name.localeCompare(b.name));
        break;
      case "hours":
        list.sort((a, b) => b.actualHours - a.actualHours || a.name.localeCompare(b.name));
        break;
      case "name":
        list.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }
    return list;
  }, [result.employees, dept, query, order]);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-sdc-border-soft px-3 py-2">
        <label className="sr-only" htmlFor="util-emp-search">
          Search employee
        </label>
        <input
          id="util-emp-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search employee…"
          className={`${INPUT} min-w-[10rem] flex-1 !py-1.5 text-sm`}
        />
        <label className="sr-only" htmlFor="util-emp-dept">
          Department
        </label>
        <select
          id="util-emp-dept"
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          className={`${INPUT} w-auto shrink-0 !py-1.5 pr-8 text-sm`}
        >
          <option value="__scope__">Billable departments</option>
          <option value="__all__">All departments</option>
          {departments.map((d) => (
            <option key={d.key} value={d.key}>
              {d.title}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="util-emp-sort">
          Sort
        </label>
        <select
          id="util-emp-sort"
          value={order}
          onChange={(e) => setOrder(e.target.value as EmpSort)}
          className={`${INPUT} w-auto shrink-0 !py-1.5 pr-8 text-sm`}
        >
          <option value="utilAsc">Lowest utilization</option>
          <option value="utilDesc">Highest utilization</option>
          <option value="hours">Most hours</option>
          <option value="name">Name</option>
        </select>
      </div>

      {rows.length === 0 ? (
        <p className="px-3 py-6 text-sm text-sdc-muted">No employees match that filter.</p>
      ) : (
        // Capped height with its own scroll so a 50-person list cannot stretch the
        // Dashboard; the department table above stays the page's anchor.
        <ul className="max-h-[22rem] overflow-y-auto">
          {rows.map((e) => {
            const tone = utilTone(e.utilizationPct);
            const width = e.utilizationPct === null ? 0 : Math.min(100, e.utilizationPct * 100);
            return (
              <li key={e.employeeId} className={`flex items-center gap-3 px-3 py-1.5 text-sm ${TABLE_ROW_HOVER}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sdc-navy">{e.name}</span>
                  <span className="block truncate text-xs text-sdc-muted">{e.departmentTitle}</span>
                </span>
                <span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-sdc-muted sm:block">
                  {hoursFmt(e.actualHours)}h
                </span>
                <span className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-sdc-gray-100 sm:w-32" aria-hidden>
                  <span className={`block h-full rounded-full ${tone.bar}`} style={{ width: `${width}%` }} />
                </span>
                <span className={`w-11 shrink-0 text-right text-sm font-semibold tabular-nums ${tone.text}`}>
                  {pctFmt(e.utilizationPct)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function UtilizationPanel({ result, monthLabel }: { result: DepartmentUtilizationResult; monthLabel: string }) {
  const hasHours = result.total.actualHours > 0;

  return (
    <section className={card("p-0")} aria-label="Department and employee utilization">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-sdc-border px-5 py-3">
        <SectionTitle>Department Utilization</SectionTitle>
        <p className="text-xs text-sdc-muted">
          {monthLabel} · {result.workingDays} working days · theoretical = headcount × {result.workingDays} × 8h
          {!result.travelKnown && " · travel not recorded for this month"}
        </p>
      </header>

      {!hasHours ? (
        <p className="px-5 py-8 text-sm text-sdc-muted">No hours booked in {monthLabel} yet.</p>
      ) : (
        <>
          <DepartmentTable result={result} />
          <div className="border-t border-sdc-border">
            <div className="flex items-baseline justify-between gap-3 px-5 pt-3">
              <SectionTitle>Employee Utilization</SectionTitle>
              <p className="text-xs text-sdc-muted">Billable hours ÷ hours worked</p>
            </div>
            <EmployeeUtilization result={result} />
          </div>
        </>
      )}
    </section>
  );
}
