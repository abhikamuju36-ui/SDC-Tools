"use client";

import { useMemo, useState } from "react";
import { hours as fmtHours, hoursCell, hoursExact } from "@/components/ui/format";
// The one drill-through design (§47). See components/ui/Drill.tsx for why the panels
// supply data and the design lives there.
import {
  DRILL_NUM,
  DRILL_TOTAL_LABEL,
  DrillControls,
  DrillEmpty,
  DrillFilters,
  DrillGroup,
  DrillGroupOption,
  DrillGroupTray,
  DrillLines,
  DrillPanel,
  DrillSelect,
  DrillTable,
} from "@/components/ui/Drill";
import type { JobHoursDetail } from "@/lib/job-hours-detail";
// The two canonical orders the grid itself reads in — see the note on groupHoursRows.
import { EMPLOYEE_TEAMS, teamFor } from "@/lib/employee-teams";
import { SECTIONS } from "@/lib/sections";

// The dimensions the punch list can be rolled up by. Exported because the Undefined
// Hours panel offers the same rollup over the same row shape, and a second copy of this
// vocabulary is one that eventually disagrees about what "Section" groups on.
export type GroupKey = "department" | "employee" | "section" | "job";

export const GROUP_LABEL: Record<GroupKey, string> = {
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
// ── Order (changed 2026-08-05, by request) ─────────────────────────────────
//
// Grouped by DEPARTMENT or by SECTION, the rows now come out in the order the Monthly
// ETC grid reads left to right, so the drill and the table underneath it can be
// compared line for line. Hours-descending re-sorted the departments on every filter
// change, which meant the drill and the grid agreed on the totals and disagreed on the
// order — the reading you actually do between the two is "is Controls the same in
// both", and that is a lot harder when the rows move.
//
// Neither order is derived here. Departments follow EMPLOYEE_TEAMS (lib/employee-teams),
// which is already the canonical order and already knows the alias names — "Mechanical
// Build / Manufacturing" and "Mechanical Build" are one team. Sections follow SECTIONS,
// which IS the grid's column order. A second hand-written list of either is one that
// eventually disagrees with the grid it is supposed to match.
//
// Every other dimension — employee, job, and any combination — keeps hours descending:
// there is no grid order for those, and "where did the time go" is the right first row.
// Ties break on the key so the order is stable across renders rather than dependent on
// Map insertion.
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
  const groups = [...map.values()];

  // A single dimension that the grid has an order for uses that order. Combinations are
  // left on hours-descending: "Department › Employee" has no grid equivalent, and
  // ordering the outer level while the inner one stayed by size would read as neither.
  if (groupBy.length === 1 && (groupBy[0] === "department" || groupBy[0] === "section")) {
    const rank = groupBy[0] === "department" ? departmentRank : sectionRank;
    return groups.sort((a, b) => {
      const ra = rank(a.values[0]);
      const rb = rank(b.values[0]);
      // Anything the grid has no place for sorts after everything it does — by hours, so
      // an unrecognised department is still ordered usefully among its own kind rather
      // than alphabetically.
      if (ra !== rb) return ra - rb;
      return b.hours - a.hours || a.key.localeCompare(b.key);
    });
  }

  return groups.sort((a, b) => b.hours - a.hours || a.key.localeCompare(b.key));
}

// Position of a department in the grid's reading order, via the canonical team table.
// UNRANKED (not -1) for anything unmapped, so it sorts last rather than first.
const UNRANKED = Number.MAX_SAFE_INTEGER;

export function departmentRank(label: string): number {
  const team = teamFor({ department: label });
  if (!team) return UNRANKED;
  const i = EMPLOYEE_TEAMS.indexOf(team);
  return i === -1 ? UNRANKED : i;
}

// Sections are grouped as "code — name" (see groupValue), so the code is read off the
// front rather than the whole label being matched.
export function sectionRank(label: string): number {
  const code = label.split(" — ")[0]?.trim() ?? label.trim();
  const i = SECTIONS.findIndex((s) => s.code === code);
  return i === -1 ? UNRANKED : i;
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
  className,
}: {
  detail: JobHoursDetail;
  initialSection?: string | null;
  // Layout the CALLER owns: spacing when this sits below something, `h-full` when it
  // sits beside something and the two are meant to be the same height. The panel used
  // to hardcode `mt-4`, which was right for its only caller at the time and wrong the
  // moment it acquired a second one.
  className?: string;
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
  // Opens grouped by DEPARTMENT (2026-08-03, by request). A raw punch list is the wrong
  // first view: 25 lines of "NOT DEFINED / Jake Wiegand" answers "which punches" when the
  // question being asked is "where did the time go". Department is the coarsest useful
  // answer, and the chips take you finer or back to the lines in one click.
  const [groupBy, setGroupBy] = useState<GroupKey[]>(["department"]);
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

  // Which columns the flat (ungrouped) punch list shows. Named so the header and the
  // body read the same list rather than two hand-kept copies.
  const flatCols = ["Date", ...(showJob ? ["Job"] : []), "Employee", "Department", "Section", "Hours"];
  // What the table currently IS — the active rollup, with no punch count attached
  // anywhere in it (§62: "3 groups by department · 680 of 680 punches" is now just
  // "Grouped by department"). Counts are gone from every level — this line, each
  // group row, and the expand/collapse tooltip in DrillGroup — while the Hours column
  // and the total stay untouched; §62 only asks to stop counting rows, not hours.
  const meta = grouped
    ? `Grouped by ${groupBy.map((k) => GROUP_LABEL[k].toLowerCase()).join(" › ")}`
    : showJob
      ? "Every punch booked this month"
      : "Every punch booked on this job";

  return (
    // Spacing is the caller's business (`className`) — the panel used to hardcode `mt-4`,
    // which was right for its only caller at the time and wrong the moment it sat BESIDE
    // the card that opens it rather than below it.
    <DrillPanel
      title={title ?? "Hours Detail"}
      meta={`${meta}${detail.truncated ? " · oldest punches omitted past the cap" : ""}`}
      note={note}
      onClose={onClose}
      className={className}
      controls={
        <DrillControls>
          {/* The rollup comes first: it changes what the table IS, where the selects
              below only narrow it. Multi-select and click-ordered — see the note where
              groupBy is declared — which is why these are `aria-pressed` toggles in a
              tray rather than the reference's five radio tabs. */}
          <DrillGroupTray>
            {GROUP_KEYS.map((k) => {
              const on = groupBy.includes(k);
              const rank = groupBy.indexOf(k) + 1;
              return (
                <DrillGroupOption
                  key={k}
                  on={on}
                  onClick={() => toggleGroup(k)}
                  title={
                    on
                      ? `Grouped by ${GROUP_LABEL[k].toLowerCase()} (level ${rank}) — click to remove`
                      : `Roll the punches up by ${GROUP_LABEL[k].toLowerCase()}`
                  }
                >
                  {/* The ordinal only appears once there are two or more levels, where
                      the order actually changes the reading. */}
                  {groupBy.length > 1 && on ? `${rank}. ` : ""}
                  {GROUP_LABEL[k]}
                </DrillGroupOption>
              );
            })}
            {/* The reference's "None". Named "Punches" because that is what it shows, and
                it is IN the tray rather than a separate Ungroup button beside it — one
                control answering "how is this rolled up", with every answer including
                "not at all" in the same place. */}
            <DrillGroupOption
              on={!grouped}
              onClick={() => {
                setGroupBy([]);
                setExpanded(new Set());
              }}
              title="Show the individual punches"
            >
              Punches
            </DrillGroupOption>
          </DrillGroupTray>

          <DrillFilters>
            <DrillSelect value={section} onChange={setSection} label="Filter by section">
              <option value="">All sections</option>
              {detail.sections.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} — {s.name} ({Math.round(s.hours).toLocaleString()})
                </option>
              ))}
            </DrillSelect>
            <DrillSelect value={employee} onChange={setEmployee} label="Filter by employee">
              <option value="">All employees</option>
              {employees.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </DrillSelect>
            {showJob && (
              <DrillSelect value={job} onChange={setJob} label="Filter by job">
                <option value="">All jobs</option>
                {jobs.map((j) => (
                  <option key={j} value={j}>
                    {j}
                  </option>
                ))}
              </DrillSelect>
            )}
          </DrillFilters>
        </DrillControls>
      }
    >
      {rows.length === 0 ? (
        // Distinguishes "nothing ingested" from "your filters exclude everything" — the
        // fixes are completely different.
        <DrillEmpty>
          {detail.rows.length === 0
            ? "No punch-level hours stored for this job yet. They land with the next hours sync."
            : "No punches match these filters."}
        </DrillEmpty>
      ) : grouped ? (
        <DrillTable
          columns={groupBy.map((k) => GROUP_LABEL[k])}
          unit="Hours"
          totalLabel={rows.length === detail.rows.length ? "Total" : "Shown"}
          total={fmtHours(total)}
          totalTitle={hoursExact(total)}
        >
          {grouped.map((g) => (
            <DrillGroup
              key={g.key}
              values={g.values}
              total={hoursCell(g.hours)}
              totalTitle={hoursExact(g.hours)}
              open={expanded.has(g.key)}
              onToggle={() => toggleExpanded(g.key)}
              columns={groupBy.length}
            >
              {/* A grouped dimension is CONSTANT inside the group, so printing it on
                  every line would just repeat the row that was clicked to get here —
                  see detailCols. */}
              <DrillLines
                head={
                  <>
                    <th className="w-24">Date</th>
                    {detailCols.job && <th className="w-56">Job</th>}
                    {detailCols.employee && <th>Employee</th>}
                    {detailCols.department && <th className="w-44">Department</th>}
                    {detailCols.section && <th className="w-40">Section</th>}
                    <th className="w-20 text-right">Hours</th>
                  </>
                }
              >
                {g.rows.map((r, ri) => (
                  <tr key={`${r.date}-${r.employee}-${r.section}-${ri}`}>
                    <td className="font-mono tabular-nums text-sdc-muted">{r.date}</td>
                    {detailCols.job && (
                      <td className="text-sdc-gray-700" title={r.job}>
                        <span className="line-clamp-1">{r.job}</span>
                      </td>
                    )}
                    {detailCols.employee && <td className="text-sdc-gray-700">{r.employee}</td>}
                    {detailCols.department && <td className="text-sdc-muted">{r.department}</td>}
                    {detailCols.section && (
                      <td className="text-sdc-muted">
                        <span className="font-mono">{r.section}</span>
                        {r.sectionName ? ` — ${r.sectionName}` : ""}
                      </td>
                    )}
                    <td className={DRILL_NUM} title={hoursExact(r.hours)}>
                      {hoursCell(r.hours)}
                    </td>
                  </tr>
                ))}
              </DrillLines>
            </DrillGroup>
          ))}
        </DrillTable>
      ) : (
        // Ungrouped: the punch list itself, shown directly rather than behind one
        // collapsed "All punches" group the way the reference's "None" does — this panel
        // has always shown the punches on arrival and making that a click is a step
        // backwards. The total rides in the table's own tfoot, where it cannot drift out
        // of the column it totals.
        //
        // No scroll container of its own any more (§49). This used to be capped at 24rem
        // inside a panel that was otherwise unbounded; the panel is now capped and its
        // body is the scroller, so a second one here would mean two scrollbars, the
        // shorter of the two winning, and the Lines view showing less than the rollup
        // beside it on the same screen. The sticky header and footer work against the
        // panel's scroller exactly as they did against this one.
        <>
          <DrillLines
            head={
              <>
                <th className="w-24">Date</th>
                {showJob && <th className="w-56">Job</th>}
                <th>Employee</th>
                <th className="w-44">Department</th>
                <th className="w-20">Section</th>
                <th className="w-40">Section Name</th>
                <th className="w-20 text-right">Hours</th>
              </>
            }
            foot={
              <tr>
                <td className={DRILL_TOTAL_LABEL} colSpan={flatCols.length - 1}>
                  {rows.length === detail.rows.length ? "Total" : "Shown"}
                </td>
                <td className={`${DRILL_NUM} text-sm font-semibold`} title={hoursExact(total)}>
                  {fmtHours(total)}
                </td>
              </tr>
            }
          >
            {rows.map((r, i) => (
              <tr key={`${r.date}-${r.employee}-${r.section}-${i}`}>
                <td className="font-mono tabular-nums text-sdc-muted">{r.date}</td>
                {showJob && (
                  <td className="text-sdc-gray-700" title={r.job}>
                    <span className="line-clamp-1">{r.job}</span>
                  </td>
                )}
                <td className="text-sdc-gray-700">{r.employee}</td>
                <td className="text-sdc-muted">{r.department}</td>
                <td className="font-mono text-sdc-muted">{r.section}</td>
                <td className="text-sdc-muted">{r.sectionName}</td>
                {/* Rounded, like every other hours figure in the app; the title keeps the
                    exact punch reachable. */}
                <td className={DRILL_NUM} title={hoursExact(r.hours)}>
                  {hoursCell(r.hours)}
                </td>
              </tr>
            ))}
          </DrillLines>
        </>
      )}
    </DrillPanel>
  );
}
