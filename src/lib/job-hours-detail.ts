import "server-only";
import { prisma } from "@/lib/prisma";
import { SECTIONS } from "@/lib/sections";

// "Hours Detail" — the punch-level rows behind a job's Actual hours, recreating
// the Power BI report's drillthrough page: one line per employee per day per
// section, with a total that reconciles to the section bars above it.
//
// Whole job with a Section column (rather than only the section that was
// clicked), per Dan: the useful question is usually "who has been on this job",
// and a section filter on top of the full list answers both.

const SECTION_NAME = new Map(SECTIONS.map((s) => [s.code, s.name]));

export type HoursDetailRow = {
  date: string; // YYYY-MM-DD
  employee: string; // resolved name, or the raw Paylocity id
  department: string;
  section: string; // Section-Function Code
  sectionName: string;
  hours: number;
  // Only set when the detail spans more than one job (the Monthly ETC month
  // view). Absent on the per-job drill, where a Job column would repeat the
  // page heading on every row.
  job?: string;
};

export type JobHoursDetail = {
  rows: HoursDetailRow[];
  total: number;
  // Sections present in the data, for the panel's filter. Only what's actually
  // there — offering an empty section would filter to nothing.
  sections: { code: string; name: string; hours: number }[];
  // True when the row cap below cut the list, so the UI can say so rather than
  // quietly showing a partial total.
  truncated: boolean;
};

// A job with years of history could carry thousands of punches, and this payload
// crosses the server→client boundary on every page load. 4,000 is far above any
// real job (the largest on 2026-07-30 was well under 1,000) while still bounding
// the worst case.
const MAX_ROWS = 4000;

export async function getJobHoursDetail(jobPks: number[]): Promise<JobHoursDetail> {
  const empty: JobHoursDetail = { rows: [], total: 0, sections: [], truncated: false };
  if (jobPks.length === 0) return empty;

  const [detail, employees] = await Promise.all([
    prisma.jobHoursDetail.findMany({
      where: { jobId: { in: jobPks } },
      select: { section: true, workDate: true, employeeId: true, hours: true },
      // Newest first, like the report's page (its Date column sorts descending).
      orderBy: [{ workDate: "desc" }, { section: "asc" }],
      take: MAX_ROWS + 1, // one extra, purely to detect truncation
    }),
    prisma.employee.findMany({
      where: { paylocityId: { not: null } },
      select: { paylocityId: true, name: true, department: true },
    }),
  ]);

  const byPaylocityId = new Map(employees.map((e) => [e.paylocityId!, e]));

  const truncated = detail.length > MAX_ROWS;
  const kept = truncated ? detail.slice(0, MAX_ROWS) : detail;

  const rows: HoursDetailRow[] = kept.map((d) => {
    const emp = byPaylocityId.get(d.employeeId);
    return {
      date: d.workDate.toISOString().slice(0, 10),
      // Falling back to the raw id rather than "(undefined)" (which is what the
      // Power BI page shows): an id is actionable — someone can look it up —
      // where "(undefined)" only says the join failed. Two of 69 ids on the
      // export didn't match the roster on 2026-07-30, both likely leavers.
      employee: emp?.name ?? (d.employeeId ? `#${d.employeeId}` : "—"),
      department: emp?.department?.trim() || "—",
      section: d.section,
      sectionName: SECTION_NAME.get(d.section) ?? d.section,
      hours: Number(d.hours),
    };
  });

  // Section totals from the KEPT rows, so the filter's numbers always agree with
  // what the table can actually show.
  const bySection = new Map<string, number>();
  for (const r of rows) bySection.set(r.section, (bySection.get(r.section) ?? 0) + r.hours);

  return {
    rows,
    total: rows.reduce((s, r) => s + r.hours, 0),
    sections: [...bySection.entries()]
      .map(([code, hours]) => ({ code, name: SECTION_NAME.get(code) ?? code, hours }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    truncated,
  };
}

// Month-scoped variant, for the Monthly ETC page's KPI drill-through: every
// punch in one ETC month across the jobs the grid is showing, with a Job column.
//
// Shares the row shape (and so the whole panel component) with the per-job drill
// above. Deliberately the same table and the same name resolution — the KPI cards
// count people out of these very rows, so the drill can't disagree with the card
// that opened it.
export async function getEtcMonthHoursDetail(month: string, jobPks: number[]): Promise<JobHoursDetail> {
  const empty: JobHoursDetail = { rows: [], total: 0, sections: [], truncated: false };
  if (jobPks.length === 0) return empty;

  const [detail, employees] = await Promise.all([
    prisma.jobHoursDetail.findMany({
      where: { month, jobId: { in: jobPks } },
      select: {
        section: true,
        workDate: true,
        employeeId: true,
        hours: true,
        job: { select: { jobId: true, jobName: true } },
      },
      orderBy: [{ workDate: "desc" }, { section: "asc" }],
      take: MAX_ROWS + 1,
    }),
    prisma.employee.findMany({
      where: { paylocityId: { not: null } },
      select: { paylocityId: true, name: true, department: true },
    }),
  ]);

  const byPaylocityId = new Map(employees.map((e) => [e.paylocityId!, e]));
  const truncated = detail.length > MAX_ROWS;
  const kept = truncated ? detail.slice(0, MAX_ROWS) : detail;

  const rows: HoursDetailRow[] = kept.map((d) => {
    const emp = byPaylocityId.get(d.employeeId);
    return {
      date: d.workDate.toISOString().slice(0, 10),
      employee: emp?.name ?? (d.employeeId ? `#${d.employeeId}` : "—"),
      department: emp?.department?.trim() || "—",
      section: d.section,
      sectionName: SECTION_NAME.get(d.section) ?? d.section,
      hours: Number(d.hours),
      job: `${d.job.jobId} — ${d.job.jobName}`,
    };
  });

  const bySection = new Map<string, number>();
  for (const r of rows) bySection.set(r.section, (bySection.get(r.section) ?? 0) + r.hours);

  return {
    rows,
    total: rows.reduce((s, r) => s + r.hours, 0),
    sections: [...bySection.entries()]
      .map(([code, hours]) => ({ code, name: SECTION_NAME.get(code) ?? code, hours }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    truncated,
  };
}
