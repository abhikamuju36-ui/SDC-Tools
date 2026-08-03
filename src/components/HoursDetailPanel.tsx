"use client";

import { Fragment, useMemo, useState } from "react";
import { TABLE_HEADER_ROW, TABLE_GRID } from "@/components/ui/classnames";
import { hours as fmtHours, hoursCell, hoursExact } from "@/components/ui/format";
import type { JobHoursDetail } from "@/lib/job-hours-detail";

// The dimensions the punch list can be rolled up by.
type GroupKey = "department" | "employee" | "section" | "job";

const GROUP_LABEL: Record<GroupKey, string> = {
  department: "Department",
  employee: "Employee",
  section: "Section",
  job: "Job",
};

// The value a row contributes to a given grouping dimension.
//
// Section deliberately groups on "code — name" rather than the bare code: the two are
// 1:1, so grouping on the pair is identical to grouping on the code, and it saves
// carrying a representative row around purely to print the name.
//
// Department and Job fall back to an em dash. A punch with no department still has
// hours, and dropping it out of a rollup would make the group totals stop summing to
// the Total at the bottom.
export function groupValue(row: JobHoursDetail["rows"][number], key: GroupKey): string {
  switch (key) {
    case "department":
      return row.department || "—";
    case "employee":
      return row.employee || "—";
    case "section":
      return row.sectionName ? `${row.section} — ${row.sectionName}` : row.section;
    case "job":
      return row.job || "—";
  }
}

export type HoursGroup = {
  key: string;
  values: string[];
  lines: number;
  hours: number;
  // The punches behind the rollup, kept so expanding a group needs no second pass
  // over the data and cannot disagree with the count beside it.
  rows: JobHoursDetail["rows"];
};

// Roll punch lines up into one row per distinct combination of the chosen dimensions.
// Returns null when nothing is grouped, which is how the panel decides to render the
// punch list instead.
//
// Exported and pure so the arithmetic is testable: the invariant that matters is that
// the group hours SUM to the ungrouped total, because both are shown at once — the
// groups in the table and the total in its footer.
//
// Sorted by hours descending, since the point of a rollup is "where did the time go"
// and the answer should be the first row. Ties break on the key so the order is stable
// across renders rather than dependent on Map insertion.
export function groupHoursRows(
  rows: JobHoursDetail["rows"],
  groupBy: GroupKey[],
): HoursGroup[] | null {
  if (groupBy.length === 0) return null;
  const map = new Map<string, HoursGroup>();
  for (const r of rows) {
    const values = groupBy.map((k) => groupValue(r, k));
    // JSON rather than a joined string: collision-free by construction. Joining means
    // choosing a separator that can't appear in a department name, an employee name or
    // a job title — and on a space, ["a b", "c"] and ["a", "b c"] would collapse into
    // the same group.
    const key = JSON.stringify(values);
    const cur = map.get(key) ?? { key, values, lines: 0, hours: 0, rows: [] };
    cur.lines += 1;
    cur.hours += r.hours;
    cur.rows.push(r);
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.hours - a.hours || a.key.localeCompare(b.key));
}

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
  title,
  note,
  onClose,
}: {
  detail: JobHoursDetail;
  initialSection?: string | null;
  // Overrides the heading — the Monthly ETC drill names the month it's showing.
  title?: string;
  // Shown under the subtitle. Used to explain a gap between this table's total
  // and the figure on the card that opened it, rather than leaving the reader to
  // spot the difference and assume something is broken.
  note?: string;
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
  // The Job column only appears when the detail actually spans jobs (the Monthly
  // ETC month view). On the per-job drill it would repeat the page heading on
  // every row, so it's inferred from the data rather than passed as a flag.
  const showJob = detail.rows.some((r) => r.job);
  const jobs = useMemo(
    () => [...new Set(detail.rows.map((r) => r.job).filter((j): j is string => Boolean(j)))].sort((a, b) => a.localeCompare(b)),
    [detail.rows],
  );
  const [job, setJob] = useState<string>("");

  // ── Group by ────────────────────────────────────────────────────────────────
  //
  // Toggle chips rather than a single-choice dropdown, because the useful question
  // is usually two-dimensional: "which departments, and who inside them" (2026-08-03,
  // by request). Order is CLICK order, so Department then Employee reads
  // department-major and the reverse reads employee-major — the same data pivoted,
  // and which one is right depends on what you are chasing.
  //
  // With nothing selected the table is the punch list it has always been. Selecting
  // anything switches it to one row per distinct combination, with a line count so a
  // group of 1 is distinguishable from a group of 40 at the same total.
  //
  // Grouping applies to the FILTERED rows, so it composes with the three selects
  // rather than competing with them, and the Total stays the same figure either way.
  const [groupBy, setGroupBy] = useState<GroupKey[]>([]);
  // Which groups are opened to show the punches inside them. Cleared whenever the
  // grouping changes, because the keys it holds describe the OLD shape — a stale key
  // wouldn't crash (it simply wouldn't match) but it would leave rows silently open or
  // shut for reasons the reader can't see.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleGroup = (k: GroupKey) => {
    setExpanded(new Set());
    setGroupBy((prev) => (prev.includes(k) ? prev.filter((g) => g !== k) : [...prev, k]));
  };
  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const rows = useMemo(
    () =>
      detail.rows.filter(
        (r) =>
          (!section || r.section === section) &&
          (!employee || r.employee === employee) &&
          (!job || r.job === job),
      ),
    [detail.rows, section, employee, job],
  );
  const total = rows.reduce((s, r) => s + r.hours, 0);

  // null when nothing is grouped — the punch list renders instead. See groupHoursRows.
  const grouped = useMemo(() => groupHoursRows(rows, groupBy), [rows, groupBy]);

  // Job is only offered when the data actually spans jobs — same rule as the column.
  const GROUP_KEYS: GroupKey[] = showJob
    ? ["department", "employee", "section", "job"]
    : ["department", "employee", "section"];

  // Which columns an expanded group's punch lines show. A grouped dimension is
  // CONSTANT inside the group, so printing it on every line would just repeat the row
  // that was clicked to get there. Date and Hours always show — they are the only two
  // that vary no matter how the rollup is built.
  const detailCols = {
    job: showJob && !groupBy.includes("job"),
    employee: !groupBy.includes("employee"),
    department: !groupBy.includes("department"),
    section: !groupBy.includes("section"),
  };

  const SELECT =
    "h-7 rounded-md border border-sdc-border bg-white px-1.5 text-[11px] text-sdc-navy outline-none focus:border-sdc-blue";
  const CHIP =
    "h-7 rounded-md border px-2 text-[11px] font-medium transition-colors focus-visible:outline-none";
  const CHIP_OFF = "border-sdc-border bg-white text-sdc-navy hover:bg-sdc-blue-light";
  const CHIP_ON = "border-sdc-blue bg-sdc-blue text-white hover:bg-sdc-blue-dark";

  return (
    <div className="mt-4 rounded-lg border border-sdc-blue-100 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-sdc-navy">{title ?? "Hours Detail"}</p>
          <p className="text-[11px] text-sdc-gray-500">
            {/* Says what the table currently IS. Grouped, "25 of 25 lines" would
                describe rows that are no longer on screen. */}
            {grouped
              ? `${grouped.length.toLocaleString()} ${grouped.length === 1 ? "group" : "groups"} by ${groupBy
                  .map((k) => GROUP_LABEL[k].toLowerCase())
                  .join(" › ")} — from ${rows.length.toLocaleString()} of ${detail.rows.length.toLocaleString()} lines`
              : `${showJob ? "Every booked punch this month" : "Every booked punch on this job"} — ${rows.length.toLocaleString()} of ${detail.rows.length.toLocaleString()} lines`}
            {detail.truncated && " (capped at 4,000 — oldest lines omitted)"}
          </p>
          {note && <p className="mt-0.5 max-w-2xl text-[11px] leading-tight text-sdc-yellow-text">{note}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Group-by chips. Combinable and click-ordered — see the note where
              groupBy is declared. Placed before the filters because rolling up
              changes what the table IS, where the selects only narrow it. */}
          <span className="text-[11px] font-medium text-sdc-gray-500">Group by</span>
          {GROUP_KEYS.map((k) => {
            const on = groupBy.includes(k);
            const rank = groupBy.indexOf(k) + 1;
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggleGroup(k)}
                aria-pressed={on}
                title={
                  on
                    ? `Grouped by ${GROUP_LABEL[k].toLowerCase()} (level ${rank}) — click to remove`
                    : `Roll the lines up by ${GROUP_LABEL[k].toLowerCase()}`
                }
                className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}
              >
                {/* The ordinal only appears once there are two or more levels, where
                    the order actually changes the reading. */}
                {groupBy.length > 1 && on ? `${rank}. ` : ""}
                {GROUP_LABEL[k]}
              </button>
            );
          })}
          {grouped && (
            <button
              type="button"
              onClick={() => {
                setGroupBy([]);
                setExpanded(new Set());
              }}
              title="Back to the individual punch lines"
              className={`${CHIP} ${CHIP_OFF}`}
            >
              Ungroup
            </button>
          )}
          <span className="mx-0.5 h-5 w-px bg-sdc-border" aria-hidden="true" />
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
          {showJob && (
            <select value={job} onChange={(e) => setJob(e.target.value)} aria-label="Filter by job" className={SELECT}>
              <option value="">All jobs</option>
              {jobs.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
          )}
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
                {grouped ? (
                  <>
                    {groupBy.map((k) => (
                      <th key={k}>{GROUP_LABEL[k]}</th>
                    ))}
                    {/* Line count earns its column: two groups with the same total are
                        very different if one is a single punch and the other is forty. */}
                    <th className="w-16 text-right">Lines</th>
                    <th className="w-16 text-right">Hours</th>
                  </>
                ) : (
                  <>
                    <th className="w-24">Date</th>
                    {showJob && <th className="w-56">Job</th>}
                    <th>Employee</th>
                    <th className="w-44">Department</th>
                    <th className="w-20">Section</th>
                    <th className="w-40">Section Name</th>
                    <th className="w-16 text-right">Hours</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {grouped?.map((g, i) => {
                const open = expanded.has(g.key);
                return (
                  <Fragment key={g.key}>
                    <tr
                      className={`text-[11px] hover:bg-sdc-blue-light/40 ${i % 2 === 1 ? "bg-sdc-gray-50/60" : ""}`}
                    >
                      {g.values.map((v, vi) => (
                        <td key={groupBy[vi]} className="px-2 py-1 text-sdc-navy" title={v}>
                          {/* The FIRST dimension carries the disclosure control, so a
                              row has exactly one place to click to open it. A button
                              rather than an onClick on the <tr>: this is the one
                              interactive thing in the row, and it should be reachable
                              by keyboard and announce its state. */}
                          {vi === 0 ? (
                            <button
                              type="button"
                              onClick={() => toggleExpanded(g.key)}
                              aria-expanded={open}
                              title={open ? "Hide these punches" : `Show the ${g.lines} punch${g.lines === 1 ? "" : "es"} behind this`}
                              className="flex w-full items-center gap-1 text-left hover:text-sdc-blue-dark"
                            >
                              <span aria-hidden="true" className={`shrink-0 text-[9px] text-sdc-gray-500 ${open ? "rotate-90" : ""}`}>
                                ▶
                              </span>
                              <span className="line-clamp-1">{v}</span>
                            </button>
                          ) : (
                            <span className="line-clamp-1">{v}</span>
                          )}
                        </td>
                      ))}
                      <td className="px-2 py-1 text-right tabular-nums text-sdc-gray-600">{g.lines.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right font-semibold tabular-nums text-sdc-navy" title={hoursExact(g.hours)}>
                        {hoursCell(g.hours)}
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        {/* A nested table in one spanning cell, NOT more rows in this
                            one: the rollup has as many columns as there are grouping
                            dimensions and the punch list has seven, so sharing a column
                            grid would misalign one of them at every level. */}
                        <td colSpan={groupBy.length + 2} className="bg-sdc-blue-light/20 px-2 py-1.5">
                          <table className={`w-full text-sm ${TABLE_GRID}`}>
                            <thead>
                              <tr className="[&>th]:px-2 [&>th]:py-1 [&>th]:text-left [&>th]:text-[10px] [&>th]:font-semibold [&>th]:text-sdc-gray-500">
                                <th className="w-24">Date</th>
                                {detailCols.job && <th className="w-56">Job</th>}
                                {detailCols.employee && <th>Employee</th>}
                                {detailCols.department && <th className="w-44">Department</th>}
                                {detailCols.section && <th className="w-40">Section</th>}
                                <th className="w-16 text-right">Hours</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.rows.map((r, ri) => (
                                <tr key={`${r.date}-${r.employee}-${r.section}-${ri}`} className="text-[11px]">
                                  <td className="px-2 py-0.5 font-mono text-sdc-navy">{r.date}</td>
                                  {detailCols.job && (
                                    <td className="px-2 py-0.5 text-sdc-navy" title={r.job}>
                                      <span className="line-clamp-1">{r.job}</span>
                                    </td>
                                  )}
                                  {detailCols.employee && <td className="px-2 py-0.5 text-sdc-navy">{r.employee}</td>}
                                  {detailCols.department && <td className="px-2 py-0.5 text-sdc-gray-600">{r.department}</td>}
                                  {detailCols.section && (
                                    <td className="px-2 py-0.5 text-sdc-gray-600">
                                      <span className="font-mono">{r.section}</span>
                                      {r.sectionName ? ` — ${r.sectionName}` : ""}
                                    </td>
                                  )}
                                  <td
                                    className="px-2 py-0.5 text-right font-semibold tabular-nums text-sdc-navy"
                                    title={hoursExact(r.hours)}
                                  >
                                    {hoursCell(r.hours)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!grouped &&
                rows.map((r, i) => (
                <tr
                  key={`${r.date}-${r.employee}-${r.section}-${i}`}
                  className={`text-[11px] hover:bg-sdc-blue-light/40 ${i % 2 === 1 ? "bg-sdc-gray-50/60" : ""}`}
                >
                  <td className="px-2 py-1 font-mono text-sdc-navy">{r.date}</td>
                  {showJob && (
                    <td className="px-2 py-1 text-sdc-navy" title={r.job}>
                      <span className="line-clamp-1">{r.job}</span>
                    </td>
                  )}
                  <td className="px-2 py-1 text-sdc-navy">{r.employee}</td>
                  <td className="px-2 py-1 text-sdc-gray-600">{r.department}</td>
                  <td className="px-2 py-1 font-mono text-sdc-gray-600">{r.section}</td>
                  <td className="px-2 py-1 text-sdc-gray-600">{r.sectionName}</td>
                  {/* Rounded, like every other hours figure in the app; the
                      title keeps the exact punch reachable. */}
                  <td className="px-2 py-1 text-right font-semibold tabular-nums text-sdc-navy" title={hoursExact(r.hours)}>
                    {hoursCell(r.hours)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 bg-sdc-gray-100">
              <tr className="text-[11px] font-bold text-sdc-navy">
                {/* Spans everything left of Hours. Grouped that is the dimension
                    columns plus Lines; ungrouped it is the punch columns. Getting this
                    wrong doesn't error — it just shunts the total out of its column. */}
                <td className="px-2 py-1.5" colSpan={grouped ? groupBy.length + 1 : showJob ? 6 : 5}>
                  Total
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums" title={hoursExact(total)}>
                  {fmtHours(total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
