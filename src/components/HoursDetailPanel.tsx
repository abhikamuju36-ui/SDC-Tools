"use client";

import { useMemo, useState } from "react";
import { TABLE_HEADER_ROW, TABLE_GRID } from "@/components/ui/classnames";
import type { JobHoursDetail } from "@/lib/job-hours-detail";

// In-app equivalent of the Power BI report's "Hours Detail" drillthrough page:
// every punch on the job — date, who, their department, section, hours — with a
// total at the bottom.
//
// Whole job with a Section column, per Dan, plus a section filter so the
// section you drilled from is one click away. `initialSection` preselects it,
// because arriving here from a section bar and seeing every section would lose
// the context you clicked with.
//
// Sourced from the app's own Paylocity ingest, NOT Power BI's 'Hours Actual':
// the two disagree on section attribution (see JobHoursDetail in schema.prisma),
// so a model-sourced table could show a total that contradicted the bar above it.
export function HoursDetailPanel({
  detail,
  initialSection,
  onClose,
}: {
  detail: JobHoursDetail;
  initialSection?: string | null;
  onClose: () => void;
}) {
  const [section, setSection] = useState<string>(
    initialSection && detail.sections.some((s) => s.code === initialSection) ? initialSection : "",
  );
  const [employee, setEmployee] = useState<string>("");

  const employees = useMemo(
    () => [...new Set(detail.rows.map((r) => r.employee))].sort((a, b) => a.localeCompare(b)),
    [detail.rows],
  );

  const rows = useMemo(
    () =>
      detail.rows.filter((r) => (!section || r.section === section) && (!employee || r.employee === employee)),
    [detail.rows, section, employee],
  );
  const total = rows.reduce((s, r) => s + r.hours, 0);

  const SELECT =
    "h-7 rounded-md border border-sdc-border bg-white px-1.5 text-[11px] text-sdc-navy outline-none focus:border-sdc-blue";

  return (
    <div className="mt-4 rounded-lg border border-sdc-blue-100 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-sdc-navy">Hours Detail</p>
          <p className="text-[11px] text-sdc-gray-500">
            Every booked punch on this job — {rows.length.toLocaleString()} of {detail.rows.length.toLocaleString()} lines
            {detail.truncated && " (capped at 4,000 — oldest lines omitted)"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={section} onChange={(e) => setSection(e.target.value)} aria-label="Filter by section" className={SELECT}>
            <option value="">All sections</option>
            {detail.sections.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} — {s.name} ({Math.round(s.hours).toLocaleString()})
              </option>
            ))}
          </select>
          <select value={employee} onChange={(e) => setEmployee(e.target.value)} aria-label="Filter by employee" className={SELECT}>
            <option value="">All employees</option>
            {employees.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-sdc-border bg-white px-2 py-1 text-[11px] font-medium text-sdc-navy hover:bg-sdc-blue-light"
          >
            Close
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        // Distinguishes "nothing ingested" from "your filters exclude everything"
        // — the fixes are completely different.
        <p className="px-1 py-4 text-xs text-sdc-gray-500">
          {detail.rows.length === 0
            ? "No punch-level hours stored for this job yet. They land with the next hours sync."
            : "No lines match these filters."}
        </p>
      ) : (
        <div className="max-h-96 overflow-auto rounded-lg border border-sdc-border styled-scrollbar">
          <table className={`w-full text-sm ${TABLE_GRID}`}>
            <thead className="sticky top-0 z-10 bg-sdc-navy">
              <tr className={`${TABLE_HEADER_ROW} [&>th]:px-2 [&>th]:py-1.5 [&>th]:text-left [&>th]:text-white`}>
                <th className="w-24">Date</th>
                <th>Employee</th>
                <th className="w-44">Department</th>
                <th className="w-20">Section</th>
                <th className="w-40">Section Name</th>
                <th className="w-16 text-right">Hours</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.date}-${r.employee}-${r.section}-${i}`}
                  className={`text-[11px] hover:bg-sdc-blue-light/40 ${i % 2 === 1 ? "bg-sdc-gray-50/60" : ""}`}
                >
                  <td className="px-2 py-1 font-mono text-sdc-navy">{r.date}</td>
                  <td className="px-2 py-1 text-sdc-navy">{r.employee}</td>
                  <td className="px-2 py-1 text-sdc-gray-600">{r.department}</td>
                  <td className="px-2 py-1 font-mono text-sdc-gray-600">{r.section}</td>
                  <td className="px-2 py-1 text-sdc-gray-600">{r.sectionName}</td>
                  <td className="px-2 py-1 text-right font-semibold tabular-nums text-sdc-navy">
                    {r.hours.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 bg-sdc-gray-100">
              <tr className="text-[11px] font-bold text-sdc-navy">
                <td className="px-2 py-1.5" colSpan={5}>
                  Total
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {total.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
