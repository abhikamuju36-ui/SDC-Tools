import type { Prisma } from "@prisma/client";
import type { SortState } from "@/lib/table-sort";

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

export type HoursGroupBy = "job" | "employee" | "section" | "department" | "date" | "month";

export const HOURS_GROUP_BY_VALUES: readonly HoursGroupBy[] = ["job", "employee", "section", "department", "date", "month"];

// One label map for all three places that render a dimension name — the field picker,
// the tree's per-level column header, and (previously duplicated as a page.tsx-local
// const) the page itself.
export const HOURS_GROUP_BY_LABEL: Record<HoursGroupBy, string> = {
  job: "Job",
  employee: "Employee",
  section: "Function / Section",
  department: "Department",
  date: "Date",
  month: "Month",
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
export function narrowFiltersForGroupValue(filters: HoursFilters, groupBy: HoursGroupBy, value: string): HoursFilters {
  switch (groupBy) {
    case "job":
      return { ...filters, jobIds: [value] };
    case "employee":
      return { ...filters, employeeIds: [value] };
    case "section":
      return { ...filters, sections: [value] };
    case "department":
      return { ...filters, departments: [value] };
    case "month":
      return { ...filters, months: [value] };
    case "date":
      return { ...filters, from: value, to: value };
  }
}

/**
 * Department isn't a column on the punch table, so grouping by it means grouping by
 * employeeId first (small, bounded — see hours-explorer.ts) and re-rolling here. Pure so
 * the invariant that matters — every employee's hours land in exactly one department
 * bucket, and the buckets sum to the same total the employee-level rows did — has a test
 * that doesn't need a database.
 */
export function rollupByDepartment(
  byEmployee: { employeeId: string; hours: number; punchCount: number }[],
  departmentByEmployeeId: Map<string, string>,
): HoursGroupRow[] {
  const rolled = new Map<string, HoursGroupRow>();
  for (const r of byEmployee) {
    const dept = departmentByEmployeeId.get(r.employeeId) ?? "—";
    const cur = rolled.get(dept) ?? { key: dept, label: dept, hours: 0, punchCount: 0 };
    cur.hours += r.hours;
    cur.punchCount += r.punchCount;
    rolled.set(dept, cur);
  }
  return [...rolled.values()].sort((a, b) => b.hours - a.hours);
}
