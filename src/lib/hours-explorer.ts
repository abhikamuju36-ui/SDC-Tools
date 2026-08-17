import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SECTIONS, HOURS_IMPORT_CODES } from "@/lib/sections";
import { buildHoursWhere, rollupByOperationalTier, type HoursFilters, type HoursGroupBy, type HoursGroupRow, type HoursDetailSortKey } from "@/lib/hours-filters";
import { taskFor } from "@/lib/hours-operational-grouping";
import type { SortState } from "@/lib/table-sort";

export type { HoursFilters, HoursGroupBy, HoursGroupRow };

// ── The Hours tab's one read path ───────────────────────────────────────────
//
// Everything here reads JobHoursDetail — the same punch-level table actual-hours.ts and
// the Job Hour Details drill already trust — so this introduces no second definition of
// "hours worked". Job-attributed only, by request: unattributed punches stay in the
// existing Undefined Hours feature rather than being duplicated into a table whose
// columns (Job ID, Job Name) assume every row has one.
//
// Every query composes the SAME `where` (buildHoursWhere, hours-filters.ts) the table and
// the summary strip both use, so "Total Hours" is structurally SUM(current filter), never
// a second computation — the exact bug class §42.14 in this app already fixed once for
// Undefined Hours.

// SECTIONS only names the 17 codes that drive the Quoted/ETC grid columns (see
// sections.ts's own header). Codes captured since 2026-08-17 that have no such
// column — Service/Spare Parts never will — still need a real display name here
// (the flat "Function / Section" dimension and the sections filter menu both read
// this map), so any code missing from SECTIONS falls back to
// hours-operational-grouping.ts's task label rather than the bare "80-211" code.
// HOURS_IMPORT_CODES is every code JobHoursDetail.section can hold, so building
// the name map from it (rather than from SECTIONS alone) covers every code this
// map is ever actually queried with.
const SECTION_NAME = new Map<string, string>([...HOURS_IMPORT_CODES].map((code) => [code, SECTIONS.find((s) => s.code === code)?.name ?? taskFor(code)]));

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

export type HoursFilterOptions = {
  jobs: { jobId: string; jobName: string }[];
  employees: { employeeId: string; name: string; department: string }[];
  sections: { code: string; name: string }[];
  departments: string[];
};

export type HoursRow = {
  id: number;
  date: string; // YYYY-MM-DD
  employeeId: string;
  employee: string;
  department: string;
  jobId: string;
  jobName: string;
  section: string;
  sectionName: string;
  hours: number;
};

export type HoursPage = { rows: HoursRow[]; total: number; page: number; pageSize: number };

export type HoursSummary = { totalHours: number; jobs: number; employees: number; sections: number };

// Department isn't a column on JobHoursDetail — an employeeId allowlist is how a
// department filter reaches it. "—" (the em dash drill-filters.ts uses for a blank
// value) matches employees with no department set.
async function employeeIdsForDepartments(departments: string[]): Promise<string[]> {
  if (departments.length === 0) return [];
  const wantsBlank = departments.includes("—");
  const named = departments.filter((d) => d !== "—");
  const employees = await prisma.employee.findMany({
    where: {
      paylocityId: { not: null },
      OR: [...(named.length ? [{ department: { in: named } }] : []), ...(wantsBlank ? [{ department: null }, { department: "" }] : [])],
    },
    select: { paylocityId: true },
  });
  return employees.map((e) => e.paylocityId!);
}

async function resolveWhere(filters: HoursFilters) {
  const deptEmployeeIds =
    filters.departments && filters.departments.length > 0 ? await employeeIdsForDepartments(filters.departments) : undefined;
  return buildHoursWhere(filters, deptEmployeeIds);
}

/** The filter menus' own option lists — only values actually present in the punch table. */
export async function getHoursFilterOptions(): Promise<HoursFilterOptions> {
  const [jobRows, sectionRows, employeeIdRows, employees] = await Promise.all([
    prisma.jobHoursDetail.findMany({ distinct: ["jobId"], select: { job: { select: { jobId: true, jobName: true } } } }),
    prisma.jobHoursDetail.findMany({ distinct: ["section"], select: { section: true } }),
    prisma.jobHoursDetail.findMany({ distinct: ["employeeId"], select: { employeeId: true } }),
    prisma.employee.findMany({ where: { paylocityId: { not: null } }, select: { paylocityId: true, name: true, department: true } }),
  ]);

  const employeeById = new Map(employees.map((e) => [e.paylocityId!, e]));

  const jobs = jobRows
    .map((r) => ({ jobId: r.job.jobId, jobName: r.job.jobName }))
    .sort((a, b) => a.jobId.localeCompare(b.jobId, undefined, { numeric: true }));

  const sections = sectionRows
    .map((r) => ({ code: r.section, name: SECTION_NAME.get(r.section) ?? r.section }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const employeeList = employeeIdRows
    .map((r) => r.employeeId)
    .map((id) => {
      const e = employeeById.get(id);
      return { employeeId: id, name: e?.name ?? `#${id}`, department: e?.department?.trim() || "—" };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const departments = [...new Set(employeeList.map((e) => e.department))].sort((a, b) =>
    a === "—" ? 1 : b === "—" ? -1 : a.localeCompare(b),
  );

  return { jobs, sections, employees: employeeList, departments };
}

type DetailRow = {
  id: number;
  section: string;
  workDate: Date;
  employeeId: string;
  hours: unknown;
  job: { jobId: string; jobName: string };
};

// Shared by the paginated table and the export — one row shape, one join, so the file a
// manager downloads can never disagree with the table they were looking at.
async function mapDetailRows(detail: DetailRow[]): Promise<HoursRow[]> {
  const employeeIds = [...new Set(detail.map((d) => d.employeeId))];
  const employees = await prisma.employee.findMany({
    where: { paylocityId: { in: employeeIds } },
    select: { paylocityId: true, name: true, department: true },
  });
  const byPaylocityId = new Map(employees.map((e) => [e.paylocityId!, e]));

  return detail.map((d) => {
    const emp = byPaylocityId.get(d.employeeId);
    return {
      id: d.id,
      date: d.workDate.toISOString().slice(0, 10),
      employeeId: d.employeeId,
      employee: emp?.name ?? `#${d.employeeId}`,
      department: emp?.department?.trim() || "—",
      jobId: d.job.jobId,
      jobName: d.job.jobName,
      section: d.section,
      sectionName: SECTION_NAME.get(d.section) ?? d.section,
      hours: Number(d.hours),
    };
  });
}

const DETAIL_SELECT = {
  id: true,
  section: true,
  workDate: true,
  employeeId: true,
  hours: true,
  job: { select: { jobId: true, jobName: true } },
} as const;

// `id: "desc"` is always the trailing tie-breaker, sort or no sort — same reason the
// pre-sort default already had one: without it, rows with an equal sort value could
// shuffle between page loads (MySQL makes no ordering guarantee among ties), which
// would look like pagination duplicating or skipping rows.
function orderByForSort(sort: SortState<HoursDetailSortKey>): Prisma.JobHoursDetailOrderByWithRelationInput[] {
  if (!sort) return [{ workDate: "desc" }, { id: "desc" }];
  const dir = sort.direction;
  switch (sort.key) {
    case "date":
      return [{ workDate: dir }, { id: "desc" }];
    case "jobId":
      return [{ job: { jobId: dir } }, { id: "desc" }];
    case "jobName":
      return [{ job: { jobName: dir } }, { id: "desc" }];
    case "section":
      return [{ section: dir }, { id: "desc" }];
    case "hours":
      return [{ hours: dir }, { id: "desc" }];
  }
}

export async function queryHoursRows(
  filters: HoursFilters,
  opts: { page?: number; pageSize?: number; sort?: SortState<HoursDetailSortKey> } = {},
): Promise<HoursPage> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, opts.pageSize ?? DEFAULT_PAGE_SIZE));
  const where = await resolveWhere(filters);

  const [total, detail] = await Promise.all([
    prisma.jobHoursDetail.count({ where }),
    prisma.jobHoursDetail.findMany({
      where,
      select: DETAIL_SELECT,
      orderBy: orderByForSort(opts.sort ?? null),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const rows = await mapDetailRows(detail);
  return { rows, total, page, pageSize };
}

export type HoursExportRows = { rows: HoursRow[]; truncated: boolean };

// A single, un-paginated fetch for the export — bounded, not "everything with no
// question asked": an unfiltered export today is ~25k rows (fine to generate an XLSX
// from server-side), but the cap and `truncated` flag mean a much larger future table
// degrades to "the export says so" rather than a silent partial file, the same contract
// job-hours-detail.ts already uses for a job's punch drill.
const MAX_EXPORT_ROWS = 50_000;

export type HoursDrillRows = { rows: HoursRow[]; truncated: boolean };

// Terminal level of the Hours tab's Group By tree (HoursGroupedTree) — the raw
// punch records behind a leaf group (job 1116 -> Service Engineering -> …),
// fetched whole rather than paginated so expanding a row stays a single round
// trip with no nested pager UI underneath it. `filters` arrives already
// narrowed to that exact leaf (narrowFiltersForGroupValue applied once per
// ancestor level), so this is the SAME buildHoursWhere every other level's
// aggregate used — the leaf's total and the sum of these rows can never
// disagree, by construction, not by re-summing anything client-side.
//
// A smaller cap than the export's MAX_EXPORT_ROWS: this renders inline under
// one table row, not into a downloaded file, so 50k here would mean 50k
// <tr>s in the DOM instead of a spreadsheet someone scrolls outside the
// browser. `truncated` lets the caller say so plainly rather than pretending
// the visible rows are the whole story.
//
// 5,000, not a smaller "a leaf is usually small" guess: measured live, a
// single-dimension leaf as coarse as one Department (no further Group By
// level chosen at all) routinely holds 1,000-2,000 punches on its own — e.g.
// Service Engineering's 1,903 — so a lower cap would truncate the exact
// example this feature was built around. Reserved for the genuinely
// pathological case (an entire broad dimension with no narrowing at all),
// not the common one.
const MAX_DRILL_ROWS = 5000;

export async function queryHoursDrillRows(filters: HoursFilters): Promise<HoursDrillRows> {
  const where = await resolveWhere(filters);
  const detail = await prisma.jobHoursDetail.findMany({
    where,
    select: DETAIL_SELECT,
    orderBy: [{ workDate: "desc" }, { id: "desc" }],
    take: MAX_DRILL_ROWS + 1,
  });
  const truncated = detail.length > MAX_DRILL_ROWS;
  const rows = await mapDetailRows(truncated ? detail.slice(0, MAX_DRILL_ROWS) : detail);
  return { rows, truncated };
}

// `sort` defaults to the same workDate-desc order every other caller here uses
// when the table itself has no sort active — but when it does, the export's
// row order needs to match what's on screen, not silently fall back to date
// order underneath a sort the user actually chose.
export async function queryHoursExportRows(filters: HoursFilters, sort?: SortState<HoursDetailSortKey>): Promise<HoursExportRows> {
  const where = await resolveWhere(filters);
  const detail = await prisma.jobHoursDetail.findMany({
    where,
    select: DETAIL_SELECT,
    orderBy: orderByForSort(sort ?? null),
    take: MAX_EXPORT_ROWS + 1,
  });
  const truncated = detail.length > MAX_EXPORT_ROWS;
  const rows = await mapDetailRows(truncated ? detail.slice(0, MAX_EXPORT_ROWS) : detail);
  return { rows, truncated };
}

export async function queryHoursSummary(filters: HoursFilters): Promise<HoursSummary> {
  const where = await resolveWhere(filters);
  const [agg, jobs, employees, sections] = await Promise.all([
    prisma.jobHoursDetail.aggregate({ where, _sum: { hours: true } }),
    prisma.jobHoursDetail.findMany({ where, distinct: ["jobId"], select: { jobId: true } }),
    prisma.jobHoursDetail.findMany({ where, distinct: ["employeeId"], select: { employeeId: true } }),
    prisma.jobHoursDetail.findMany({ where, distinct: ["section"], select: { section: true } }),
  ]);
  return {
    totalHours: Number(agg._sum.hours ?? 0),
    jobs: jobs.length,
    employees: employees.length,
    sections: sections.length,
  };
}

export async function queryHoursGrouped(filters: HoursFilters, groupBy: HoursGroupBy): Promise<HoursGroupRow[]> {
  const where = await resolveWhere(filters);

  // "Department" is Section+Function-derived (hours-operational-grouping.ts's
  // `departmentFor`), NOT the employee's raw HR/Paylocity `Employee.department`
  // string — that regressed once already (2026-08-17) via a SEPARATE code path
  // here that grouped by `employeeId` and re-rolled by the HR field. Fixed by
  // deleting that path entirely and routing "department" through the exact
  // same `groupBy: ["section"]` + rollupByOperationalTier mechanism every other
  // operational tier already uses — there is only one way left to compute any
  // of these four dimensions, so a second implementation can't quietly grow
  // back next to it.
  if (groupBy === "sectionName" || groupBy === "functionGroup" || groupBy === "taskDescription" || groupBy === "department") {
    const g = await prisma.jobHoursDetail.groupBy({ by: ["section"], where, _sum: { hours: true }, _count: true });
    return rollupByOperationalTier(
      g.map((r) => ({ section: r.section, hours: Number(r._sum.hours ?? 0), punchCount: r._count })),
      groupBy,
    );
  }

  if (groupBy === "job") {
    const g = await prisma.jobHoursDetail.groupBy({ by: ["jobId"], where, _sum: { hours: true }, _count: true });
    const jobs = await prisma.job.findMany({ where: { id: { in: g.map((r) => r.jobId) } }, select: { id: true, jobId: true, jobName: true } });
    const byPk = new Map(jobs.map((j) => [j.id, j]));
    return g
      .map((r) => {
        const j = byPk.get(r.jobId);
        // `key` must be the business Job Id (what buildHoursWhere's jobIds filter
        // expects), not the internal PK `r.jobId` (JobHoursDetail's FK to Job.id) — a
        // group-by tree node narrows by feeding a row's `key` straight back into
        // narrowFiltersForGroupValue, so a PK here would silently narrow to the wrong
        // job (or nothing).
        return { key: j ? j.jobId : String(r.jobId), label: j ? `${j.jobId} — ${j.jobName}` : String(r.jobId), hours: Number(r._sum.hours ?? 0), punchCount: r._count };
      })
      .sort((a, b) => b.hours - a.hours);
  }

  if (groupBy === "employee") {
    const g = await prisma.jobHoursDetail.groupBy({ by: ["employeeId"], where, _sum: { hours: true }, _count: true });
    const employees = await prisma.employee.findMany({ where: { paylocityId: { in: g.map((r) => r.employeeId) } }, select: { paylocityId: true, name: true } });
    const byId = new Map(employees.map((e) => [e.paylocityId!, e.name]));
    return g
      .map((r) => ({ key: r.employeeId, label: byId.get(r.employeeId) ?? `#${r.employeeId}`, hours: Number(r._sum.hours ?? 0), punchCount: r._count }))
      .sort((a, b) => b.hours - a.hours);
  }

  if (groupBy === "section") {
    const g = await prisma.jobHoursDetail.groupBy({ by: ["section"], where, _sum: { hours: true }, _count: true });
    return g
      .map((r) => ({ key: r.section, label: `${r.section} — ${SECTION_NAME.get(r.section) ?? r.section}`, hours: Number(r._sum.hours ?? 0), punchCount: r._count }))
      .sort((a, b) => b.hours - a.hours);
  }

  if (groupBy === "month") {
    const g = await prisma.jobHoursDetail.groupBy({ by: ["month"], where, _sum: { hours: true }, _count: true });
    return g
      .map((r) => ({ key: r.month, label: r.month, hours: Number(r._sum.hours ?? 0), punchCount: r._count }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  // "date"
  const g = await prisma.jobHoursDetail.groupBy({ by: ["workDate"], where, _sum: { hours: true }, _count: true });
  return g
    .map((r) => {
      const key = r.workDate.toISOString().slice(0, 10);
      return { key, label: key, hours: Number(r._sum.hours ?? 0), punchCount: r._count };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}
