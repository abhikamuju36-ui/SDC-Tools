"use client";

import { useMemo, useState } from "react";
import { DRILL_NUM, DRILL_TOTAL_LABEL, DrillEmpty, DrillLines } from "@/components/ui/Drill";
import { SortableTh } from "@/components/ui/SortableHeader";
import { useColumnSort } from "@/components/useColumnSort";
import { sortRows, type SortColumns } from "@/lib/table-sort";
import { hoursCell, hoursExact } from "@/components/ui/format";
import type { TmHoursDrillRow } from "@/lib/tm-hours";

// The drill-through TABLE behind the T&M tab's four Hours cards (Engineering,
// Shop, PM, Manufacturing) — rendered inside the shared right-side drawer
// (BuildReadinessDrawer, see TmReportClient.tsx) that owns the
// title/subtitle/close chrome, so this is just the search box + table, on the
// same DrillLines/SortableTh primitives HoursDetailPanel already uses for
// Monthly ETC's own punch drill. Rows come from tm-report.ts's
// fetchTmHoursDrill, which applies the exact same filters + measure condition
// the KPI row's own number came from — so this table's Hours column always
// sums back to the row, whatever the current Job/Status/date selection is.

type SortKey = "date" | "employee" | "department" | "jobId" | "jobName" | "section" | "hours";

const COLUMNS: SortColumns<TmHoursDrillRow, SortKey> = {
  date: { type: "date", value: (r) => r.date },
  employee: { type: "text", value: (r) => r.employee || null },
  department: { type: "text", value: (r) => r.department || null },
  jobId: { type: "id", value: (r) => r.jobId || null },
  jobName: { type: "text", value: (r) => r.jobName || null },
  section: { type: "text", value: (r) => r.section || null },
  hours: { type: "hours", value: (r) => r.hours },
};

export function TmHoursDrillPanel({
  rows,
  error,
}: {
  /** null while the drill is loading. */
  rows: TmHoursDrillRow[] | null;
  error: string | null;
}) {
  const sort = useColumnSort<SortKey>({ key: "date", direction: "desc" });
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.employee.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q) ||
        r.jobId.toLowerCase().includes(q) ||
        r.jobName.toLowerCase().includes(q) ||
        r.section.toLowerCase().includes(q),
    );
  }, [rows, query]);

  const sorted = useMemo(() => sortRows(filtered, sort.sort, COLUMNS), [filtered, sort.sort]);
  const total = filtered.reduce((sum, r) => sum + r.hours, 0);
  const filtering = query.trim().length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-sdc-border-soft px-4 py-2.5">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search employee, job, or function…"
          className="h-7 w-full max-w-xs rounded-md border border-sdc-border-soft px-2 text-note outline-none motion-interactive focus:border-sdc-blue"
        />
      </div>
      <div className="styled-scrollbar min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <DrillEmpty>Couldn&apos;t load this detail: {error}</DrillEmpty>
        ) : rows === null ? (
          <DrillEmpty>Loading…</DrillEmpty>
        ) : sorted.length === 0 ? (
          <DrillEmpty>No hours match.</DrillEmpty>
        ) : (
          <div className="overflow-x-auto">
            <DrillLines
              head={
                <>
                  <SortableTh label="Date" sortKey="date" type="date" sort={sort.sort} onSort={sort.onSort} className="w-24" />
                  <SortableTh label="Employee" sortKey="employee" type="text" sort={sort.sort} onSort={sort.onSort} />
                  <SortableTh label="Department" sortKey="department" type="text" sort={sort.sort} onSort={sort.onSort} className="w-40" />
                  <SortableTh label="Job ID" sortKey="jobId" type="id" sort={sort.sort} onSort={sort.onSort} className="w-20" />
                  <SortableTh label="Job / Machine" sortKey="jobName" type="text" sort={sort.sort} onSort={sort.onSort} className="w-56" />
                  <SortableTh label="Function / Section" sortKey="section" type="text" sort={sort.sort} onSort={sort.onSort} className="w-44" />
                  <SortableTh label="Hours" sortKey="hours" type="hours" sort={sort.sort} onSort={sort.onSort} className="w-20" />
                </>
              }
              foot={
                <tr>
                  <td className={DRILL_TOTAL_LABEL} colSpan={6}>
                    {filtering ? "Shown" : "Total"}
                  </td>
                  <td className={`${DRILL_NUM} text-sm font-semibold`} title={hoursExact(total)}>
                    {hoursCell(total)}
                  </td>
                </tr>
              }
            >
              {sorted.map((r, i) => (
                <tr key={`${r.date}-${r.employee}-${r.jobId}-${r.section}-${i}`}>
                  <td className="font-mono tabular-nums text-sdc-muted">{r.date ?? "—"}</td>
                  <td className="text-sdc-gray-700">{r.employee || "—"}</td>
                  <td className="text-sdc-muted">{r.department || "—"}</td>
                  <td className="font-mono text-sdc-muted">{r.jobId || "—"}</td>
                  <td className="text-sdc-gray-700" title={r.jobName}>
                    <span className="line-clamp-1">{r.jobName || "—"}</span>
                  </td>
                  <td className="text-sdc-muted">{r.section || "—"}</td>
                  <td className={DRILL_NUM} title={hoursExact(r.hours)}>
                    {hoursCell(r.hours)}
                  </td>
                </tr>
              ))}
            </DrillLines>
          </div>
        )}
      </div>
    </div>
  );
}
