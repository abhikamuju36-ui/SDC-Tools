import type { Prisma } from "@prisma/client";
import type { SortState } from "@/lib/table-sort";
import { sectionNumberAndName, functionGroupFor, taskFor, departmentFor, codesInSection, codesInFunctionGroup, codesInTask, codesInDepartment, departmentOrderRank, UNDEFINED_LABEL } from "@/lib/hours-operational-grouping";
import { reconcileRounding } from "@/lib/rounding";
import { EMPLOYEE_TEAMS, teamFor } from "@/lib/employee-teams";

// ── Filtering/grouping rules for the Hours tab, kept I/O-free ──────────────────
//
// Same reason sections.ts's mapPunchToColumns and drill-filters.ts's matching logic live
// in their own no-I/O modules: this is testable without a database, and importable by
// both the query layer (hours-explorer.ts, `server-only`) and by tests.
//
// Semantics mirror drill-filters.ts exactly, just compiled to a Prisma `where` instead of
// evaluated over an in-memory row array: OR within a dimension, AND across dimensions,
// empty selection = no constraint. The Hours tab can't reuse drill-filters.ts directly —
// that model assumes the full row set is already in memory to filter over, which the
// tab's own performance requirement (don't load every punch into the browser) rules out.

export type HoursFilters = {
  jobIds?: string[];
  employeeIds?: string[];
  sections?: string[];
  // The employee's raw HR/Paylocity department string (Employee.department) —
  // a FILTER only. This must never back the "Department" Group By dimension
  // (see HoursGroupBy/rollupByOperationalTier's "department" tier, which is
  // Section+Function-derived) — that conflation is exactly what regressed
  // once already (2026-08-17). Keeping this field named `departments` even
  // though it means something narrower than the word now implies elsewhere
  // in this file, rather than renaming it, because the query-string param
  // and the filter menu's own label ("Department") are still legitimately
  // about the HR field — only the Group By dimension of the same name changed.
  departments?: string[];
  // "YYYY-MM", exact match against JobHoursDetail.month. Independent of from/to —
  // NEVER derived from or converted into a from/to range, and vice versa. A group-by
  // tree node for "month" narrows here rather than by widening from/to to the calendar
  // month, because that widening could reintroduce days an ancestor's own from/to
  // range had already excluded, inflating a child's total past its parent's. Filtering
  // on the SAME column a level groups by is what keeps a child's WHERE clause a strict
  // subset of its parent's — see narrowFiltersForGroupValue below.
  months?: string[];
  from?: string; // "YYYY-MM-DD", inclusive
  to?: string; // "YYYY-MM-DD", inclusive
};

// The Department FILTER's own display order (2026-08-17, by request — "match
// the order used in Monthly ETC"), for the raw HR strings `HoursFilters.
// departments` holds. Business order, not alphabetical: the same
// delivery-team sequence employee-teams.ts already defines. Also the
// canonical department rank for the Hours tab's "Group By Department" sort
// (HoursDetailPanel.tsx imports this directly, rather than keeping its own
// copy — a since-removed local copy collapsed the blank "—" bucket and a
// real-but-unmapped department to the same rank; see below for why they must
// not tie). A raw HR string that resolves to one of the 7 teams (via that
// file's own alias table, e.g. "Mechanical Build / Manufacturing" -> Build)
// ranks by that team's position; anything else (Finance, Sales, a typo, a
// since-renamed department) sorts alphabetically after every ranked team;
// the blank "—" bucket always sorts last of all.
// This is the FILTER's own order — see `departmentOrderRank` in
// hours-operational-grouping.ts for the unrelated Group By dimension's order,
// which is Section+Function-derived and has no reason to share a function
// with this HR-string one even though both now read "business order, not
// alphabetical."
export function departmentFilterRank(department: string): number {
  if (department === "—") return Number.MAX_SAFE_INTEGER;
  const team = teamFor({ department });
  const i = team ? EMPLOYEE_TEAMS.indexOf(team) : -1;
  return i === -1 ? Number.MAX_SAFE_INTEGER - 1 : i;
}

export type HoursGroupBy = "job" | "employee" | "section" | "department" | "date" | "month" | "sectionName" | "functionGroup" | "taskDescription";

export const HOURS_GROUP_BY_VALUES: readonly HoursGroupBy[] = [
  "job",
  "employee",
  "section",
  "department",
  "date",
  "month",
  "sectionName",
  "functionGroup",
  "taskDescription",
];

// One label map for all three places that render a dimension name — the field picker,
// the tree's per-level column header, and (previously duplicated as a page.tsx-local
// const) the page itself.
//
// "Section Name"/"Function Group"/"Task Description"/"Department" are all the standard
// operational hierarchy (hours-operational-grouping.ts) — deliberately worded
// differently from "Function / Section" (the raw code, e.g. "10-313 — Software") so the
// dimensions are never confused with each other in the Group By menu. "Department" here
// is Section+Function-derived (departmentFor/codesInDepartment), NOT the employee's raw
// HR department string — that field is a separate FILTER (HoursFilters.departments) and
// must never back this label again (2026-08-17 regression fix).
export const HOURS_GROUP_BY_LABEL: Record<HoursGroupBy, string> = {
  job: "Job",
  employee: "Employee",
  section: "Function / Section",
  department: "Department",
  date: "Date",
  month: "Month",
  sectionName: "Section Name",
  functionGroup: "Function Group",
  taskDescription: "Task Description",
};

/**
 * Parses the `groupBy` query param into an ORDERED list of dimensions — order is
 * meaningful (Job -> Employee nests differently than Employee -> Job), unlike every
 * other Hours param, which is an unordered set. De-dupes (a dimension selected twice
 * would nest under itself) and drops unknown values rather than rejecting the whole
 * list, so a stale/hand-edited URL degrades to "whatever's still valid" instead of
 * clearing every level. A bookmarked single-value `?groupBy=job` (pre-multi-level)
 * still parses to `["job"]` with no special-casing.
 */
export function parseHoursGroupByList(v: string | undefined): HoursGroupBy[] {
  if (!v) return [];
  const seen = new Set<HoursGroupBy>();
  const out: HoursGroupBy[] = [];
  for (const raw of v.split(",").map((s) => s.trim())) {
    if ((HOURS_GROUP_BY_VALUES as readonly string[]).includes(raw) && !seen.has(raw as HoursGroupBy)) {
      seen.add(raw as HoursGroupBy);
      out.push(raw as HoursGroupBy);
    }
  }
  return out;
}

export type HoursGroupRow = { key: string; label: string; hours: number; punchCount: number };

// ── Detail-table sort ────────────────────────────────────────────────────────
//
// Only columns with a real, directly-orderable column or to-one relation on
// JobHoursDetail are sortable — "date" (workDate), "jobId"/"jobName" (via the `job`
// relation, already joined), "section", "hours". Employee and Department are
// deliberately left non-sortable: employeeId is a plain Paylocity id string with no
// Prisma relation to Employee (a real join would need a schema change), so ordering by
// it would reorder rows by an opaque id rather than the visible name — same "leave it
// plain rather than force a misleading sort" call the off-grid drill's list-valued
// columns already make elsewhere in this app.
export type HoursDetailSortKey = "date" | "jobId" | "jobName" | "section" | "hours";

export const HOURS_DETAIL_SORT_KEYS: readonly HoursDetailSortKey[] = ["date", "jobId", "jobName", "section", "hours"];

/** The detail table is server-paginated, so sort has to be a real `ORDER BY` (see
 *  hours-explorer.ts's orderByForSort) — a client-side sort would only reorder the
 *  current page, silently misrepresenting the other 24,900 rows as unsorted. */
export function parseHoursSort(sortParam: string | undefined, dirParam: string | undefined): SortState<HoursDetailSortKey> {
  if (!sortParam || !(HOURS_DETAIL_SORT_KEYS as readonly string[]).includes(sortParam)) return null;
  return { key: sortParam as HoursDetailSortKey, direction: dirParam === "desc" ? "desc" : "asc" };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ── Query-string <-> HoursFilters, in ONE place ─────────────────────────────
//
// Read by both the page (the table it renders) and the export route (the file it
// builds) — the same reason projects-query.ts exists: "the export matches the table" is
// only true if the two build the filter from the same code, not two copies of it.
//
// Plain comma-join, unlike quoted-display-prefs.ts's escaped encodeParamList/
// decodeParamList: those exist because Projects filters on customer NAMES, which
// legitimately contain commas ("FIRST SOLAR, INC."). Every Hours dimension is a job id,
// a Paylocity employee id, a section code, or a department name — none of which do.

export type HoursSearchParams = {
  jobs?: string;
  employees?: string;
  sections?: string;
  departments?: string;
  from?: string;
  to?: string;
  // Not read by parseHoursFilters below (they don't affect WHICH rows match, only
  // how they're grouped/ordered) — carried on this type so the export route can
  // parse them off the SAME query string via parseHoursGroupByList/parseHoursSort
  // instead of the export reconstructing its own copy of "what does the page's URL
  // mean" and risking it drifting from what the table actually shows.
  groupBy?: string;
  sort?: string;
  dir?: string;
};

function splitParam(v: string | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  const list = v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

export function parseHoursFilters(sp: HoursSearchParams): HoursFilters {
  return {
    jobIds: splitParam(sp.jobs),
    employeeIds: splitParam(sp.employees),
    sections: splitParam(sp.sections),
    departments: splitParam(sp.departments),
    from: sp.from || undefined,
    to: sp.to || undefined,
  };
}

/** A plain-English summary of the active filters, for the export subtitle and audit log. */
export function describeHoursFilters(f: HoursFilters): string {
  const parts: string[] = [];
  parts.push(f.jobIds?.length ? `jobs: ${f.jobIds.length === 1 ? f.jobIds[0] : `${f.jobIds.length} selected`}` : "all jobs");
  parts.push(f.employeeIds?.length ? `${f.employeeIds.length} employee${f.employeeIds.length === 1 ? "" : "s"}` : "all employees");
  parts.push(
    f.sections?.length ? `${f.sections.length} function${f.sections.length === 1 ? "" : "s"}/section${f.sections.length === 1 ? "" : "s"}` : "all functions",
  );
  parts.push(f.departments?.length ? `${f.departments.length} department${f.departments.length === 1 ? "" : "s"}` : "all departments");
  if (f.from || f.to) parts.push(`${f.from ?? "…"} to ${f.to ?? "…"}`);
  return parts.join(", ");
}

/**
 * Employee and department are two constraints on the same "who" concept, so when both are
 * set at once they must intersect (a punch from the picked employee AND in the picked
 * department), not each independently widen the match — the same AND-across-dimensions
 * rule drill-filters.ts uses for every other pair of dimensions.
 *
 * `departmentEmployeeIds` — the employee ids the department selection resolves to
 * (department isn't a column on the punch table itself) — is resolved by the caller,
 * since that lookup needs the Employee table and this function stays I/O-free.
 */
export function buildHoursWhere(
  filters: HoursFilters,
  departmentEmployeeIds?: string[],
): Prisma.JobHoursDetailWhereInput {
  const where: Prisma.JobHoursDetailWhereInput = {};

  if (filters.jobIds && filters.jobIds.length > 0) {
    where.job = { jobId: { in: filters.jobIds } };
  }
  if (filters.sections && filters.sections.length > 0) {
    where.section = { in: filters.sections };
  }
  if (filters.months && filters.months.length > 0) {
    where.month = { in: filters.months };
  }

  const employeeConstraints: string[][] = [];
  if (filters.employeeIds && filters.employeeIds.length > 0) employeeConstraints.push(filters.employeeIds);
  if (filters.departments && filters.departments.length > 0) employeeConstraints.push(departmentEmployeeIds ?? []);
  if (employeeConstraints.length === 1) {
    where.employeeId = { in: employeeConstraints[0] };
  } else if (employeeConstraints.length > 1) {
    const [a, b] = employeeConstraints;
    where.employeeId = { in: a.filter((id) => b.includes(id)) };
  }

  const fromDate = filters.from && ISO_DATE.test(filters.from) ? new Date(`${filters.from}T00:00:00.000Z`) : undefined;
  const toDate = filters.to && ISO_DATE.test(filters.to) ? new Date(`${filters.to}T23:59:59.999Z`) : undefined;
  if (fromDate || toDate) {
    where.workDate = { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) };
  }

  return where;
}

/**
 * Narrows `filters` by one more resolved value from an expanded group-by tree node —
 * e.g. a user expands the "1148" row under a "job" level, and this produces the
 * filters for that row's children (whatever the next chosen level is).
 *
 * Each case narrows on the SAME column its dimension groups by (job -> jobIds,
 * employee -> employeeIds, etc.), never a derived one. That's deliberate: it's what
 * makes a child's WHERE clause a strict SUBSET of its parent's, which in turn is what
 * makes "a group's total never disagrees with its children's" true by construction —
 * every row at every depth is an independent server aggregate over a narrowing chain
 * of subsets of the same base filter, not a client-side re-sum of anything. "date" and
 * "month" both stay on their own columns for the same reason (see the `months` field
 * above) — collapsing "month" into a from/to override would let a child's range
 * escape whatever from/to the parent already had.
 */
/**
 * The FOUR operational-hierarchy dimensions — including "department" as of
 * 2026-08-17 (see hours-operational-grouping.ts's OperationalEntry.department
 * for why it's its own tier, not an alias for functionGroup) — narrow the
 * same way `section` already does: by setting `filters.sections`, expanded
 * to every raw code the picked label covers (via hours-operational-
 * grouping.ts's reverse lookups) instead of a single code. That's still a
 * strict subset of whatever the parent's `sections` constraint already was
 * (an empty/absent constraint included), which is what keeps a child's total
 * from ever disagreeing with its parent's.
 *
 * "department" here is DELIBERATELY NOT `{ ...filters, departments: [value] }`
 * — that field is the employee's raw HR string (a different filter dimension
 * entirely, see HoursFilters.departments) and narrowing on it here is the
 * exact bug this was fixed to stop reintroducing.
 */
export function narrowFiltersForGroupValue(filters: HoursFilters, groupBy: HoursGroupBy, value: string): HoursFilters {
  switch (groupBy) {
    case "job":
      return { ...filters, jobIds: [value] };
    case "employee":
      return { ...filters, employeeIds: [value] };
    case "section":
      return { ...filters, sections: [value] };
    case "month":
      return { ...filters, months: [value] };
    case "date":
      return { ...filters, from: value, to: value };
    case "sectionName":
      return { ...filters, sections: codesInSection(value) };
    case "functionGroup":
      return { ...filters, sections: codesInFunctionGroup(value) };
    case "taskDescription":
      return { ...filters, sections: codesInTask(value) };
    case "department":
      return { ...filters, sections: codesInDepartment(value) };
  }
}

export type OperationalTier = "sectionName" | "functionGroup" | "taskDescription" | "department";

/**
 * Section isn't a column that already carries the operational label, so this groups
 * the per-raw-section aggregates (from a plain `groupBy: ["section"]` query, the same
 * one the flat "section" dimension already runs) into whichever tier of
 * hours-operational-grouping.ts's hierarchy was asked for — including "department",
 * which used to be its OWN separate code path grouping by `employeeId` and re-rolling
 * by `Employee.department` (the now-removed `rollupByDepartment`). That was the second
 * "grouping implementation" the regression fix (2026-08-17) was explicitly asked to
 * eliminate: there is exactly ONE rollup function for every operational tier now,
 * "department" included, all reading the same `bySection` aggregate. A raw code with
 * no entry in that table rolls up under UNDEFINED_LABEL rather than being dropped —
 * see that module's header for why that's the required behavior, not a fallback of
 * convenience.
 */
// ── Whole-number hours that always sum to their own displayed total (2026-08-17) ─
//
// The Hours tab must never show a decimal — every displayed hours figure is
// Math.round'd — but rounding a set of sibling rows (a Group By level's
// rows, or the root rows against the Total Hours KPI) INDEPENDENTLY can make
// their displayed sum disagree with a separately-rounded parent/KPI total by
// a unit or two, even though the underlying raw hours already sum EXACTLY
// (every JobHoursDetail.section/jobId/employeeId/etc. grouping column is
// non-nullable, so partitioning a filtered set by one and summing the parts
// reproduces the whole — see hours-explorer.ts's queryHoursGrouped). This is
// the exact "sum of roundings != rounding of the sum" class already fixed
// for the Parts Cost card (src/lib/rounding.ts) — same fix, reused rather
// than re-derived.
//
// `targetTotal` lets a caller reconcile a set of CHILD rows against their
// PARENT row's own already-displayed (and possibly ±1-adjusted) number,
// rather than a fresh rounding of the children's own raw sum — see
// reconcileRounding's own header for why that distinction matters once more
// than one level of nesting is involved. Omit it for the root level, which
// has no parent row to match — it reconciles against its own sum instead,
// which is also exactly what the Total Hours KPI's own rounding produces.
//
// Returns a Map so a caller renders in whatever (sorted) order it likes and
// still looks a row's reconciled value up by its own stable `key`.
export function reconcileGroupRowHours(rows: { key: string; hours: number }[], targetTotal?: number): Map<string, number> {
  const reconciled = reconcileRounding(rows.map((r) => r.hours), targetTotal);
  return new Map(rows.map((r, i) => [r.key, reconciled[i]]));
}

export function rollupByOperationalTier(bySection: { section: string; hours: number; punchCount: number }[], tier: OperationalTier): HoursGroupRow[] {
  const rolled = new Map<string, HoursGroupRow>();
  for (const r of bySection) {
    const label =
      tier === "sectionName"
        ? sectionNumberAndName(r.section).sectionName
        : tier === "functionGroup"
          ? functionGroupFor(r.section)
          : tier === "department"
            ? departmentFor(r.section)
            : taskFor(r.section);
    const key =
      // sectionNumber, not the display name, is the stable key a child narrowing
      // relies on — see narrowFiltersForGroupValue's "sectionName" case.
      tier === "sectionName" ? (label === UNDEFINED_LABEL ? UNDEFINED_LABEL : sectionNumberAndName(r.section).sectionNumber) : label;
    const cur = rolled.get(key) ?? { key, label, hours: 0, punchCount: 0 };
    cur.hours += r.hours;
    cur.punchCount += r.punchCount;
    rolled.set(key, cur);
  }
  const rows = [...rolled.values()];
  // "Department" reads in the fixed business order (2026-08-17, by request —
  // "match Monthly ETC exactly"), never by hours: a manager scanning down the
  // list expects PM/ME/CE/... in the same sequence every month, regardless of
  // which one happened to log the most hours. The other three tiers are
  // unaffected — sectionName/functionGroup/taskDescription still read
  // biggest-first, which is what they were built for and nobody asked to change.
  if (tier === "department") {
    return rows.sort((a, b) => departmentOrderRank(a.label) - departmentOrderRank(b.label));
  }
  return rows.sort((a, b) => b.hours - a.hours);
}
