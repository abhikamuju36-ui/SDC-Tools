import "server-only";
import { prisma } from "@/lib/prisma";
import { validJobTypeFilter, VALID_JOB_TYPES, isSdcCustomer, compareJobIds } from "@/lib/job-filters";
import { resolveEmployeeGroup } from "@/lib/employee-card-theme";
import { workforceGroupForCardKey, rollupGroup } from "@/lib/employee-workforce-groups";
import { monthlyCapacityHours, hasYearPolicy } from "@/lib/workforce-capacity-policy";
import { fetchSchedulerFatEvents, fetchSchedulerJobDisciplineOwners, type SchedulerFatEvent } from "@/lib/scheduler-db";
import { getCustomerVisits, type CustomerVisitsResult } from "@/lib/customer-visits";
import { isValidMonth } from "@/lib/etc";
import { getDepartmentUtilization, type DepartmentUtilizationResult } from "@/lib/department-utilization";

// ── One query pass for the whole dashboard (2026-08-27) ─────────────────────
//
// Every figure on the Dashboard is produced here, in ONE parallel pass, and the
// page renders what it is handed. That is a requirement of the redesign ("avoid
// separate unnecessary API calls per card", "do not duplicate business logic in
// the dashboard") and it is also what keeps the numbers reconcilable: the type
// breakdown, the customer cards and the Active Jobs KPI are three views of the
// SAME `jobs` array, read once, so they cannot disagree the way three separate
// count queries could.
//
// Nothing here defines new business rules. The job universe is job-filters.ts's
// `validJobTypeFilter` plus JOB_STATUSES (the same gate every other page uses),
// the department mapping is resolveEmployeeGroup -> workforceGroupForCardKey ->
// rollupGroup (the Employees tab's own chain), the capacity hours are
// workforce-capacity-policy.ts's published calendar, the actual hours are
// JobHoursDetail.standardDepartment (the Paylocity punch classification), and
// the FAT dates are the Scheduler's. Power BI is not read anywhere.

export type JobTypeBreakdown = { type: string; count: number; pct: number };

export type CustomerSummary = {
  name: string;
  /** SDC's own internal work, per job-filters.ts's isSdcCustomer — never a real customer. */
  internal: boolean;
  activeCount: number;
  /** Type -> count, only the types this customer actually has. */
  byType: JobTypeBreakdown[];
  jobIds: string[];
};

export type FatRow = {
  taskId: number;
  jobNumber: string;
  /** Null when the Scheduler project's job_number matches no job in this app. */
  jobName: string | null;
  customer: string | null;
  project: string;
  taskName: string;
  date: string;
  daysUntil: number;
  kind: "fat" | "pre";
  /** The FAT task's own assignee, when the scheduler set one. */
  assignee: string | null;
  meOwners: string[];
  ceOwners: string[];
};

export type WorkforceCard = {
  key: "engineering" | "shop";
  title: string;
  headcount: number;
  /** Headcount x the month's net available hours (published holiday calendar). Null when the year has no policy yet. */
  capacityHours: number | null;
  /** Hours actually booked to this department in the month, from punch data. Null when the month has no punch rows at all. */
  bookedHours: number | null;
  /** Team code -> headcount, so a card can show its mix (ME/CE/Service, Build/Wire/MFG). */
  teams: { code: string; name: string; count: number }[];
};

export type DashboardOverview = {
  month: string;
  /** True when `month` is the month we are actually in — the only month whose booked hours are legitimately partial. */
  isCurrentMonth: boolean;
  monthInFuture: boolean;
  activeTotal: number;
  headStartTotal: number;
  byType: JobTypeBreakdown[];
  customers: CustomerSummary[];
  fats: {
    /** False when the Scheduler is unconfigured or unreachable — so the UI can say that instead of "0 FATs". */
    available: boolean;
    upcoming: FatRow[];
    /** Real FATs (pre-FATs excluded) dated inside `month`. */
    monthTotal: number;
    monthWithMe: number;
    monthWithCe: number;
    monthPreFats: number;
    /** Real FATs in `month` whose job has no named ME and no named CE on its schedule. */
    monthUnstaffed: number;
    monthRows: FatRow[];
  };
  workforce: WorkforceCard[];
  visits: CustomerVisitsResult;
  // ── Department / Employee Utilization ─────────────────────────────────────
  //
  // A native rebuild of the Job Hours Report's utilization visuals — see
  // department-utilization.ts for the rules and for why its theoretical hours
  // legitimately differ from `workforce` above (that one is holiday-aware
  // capacity, this one is the report's holiday-agnostic Working Days x 8).
  // Both are on the page on purpose; they answer different questions.
  utilization: DepartmentUtilizationResult;
};

/** The month the dashboard defaults to, and the one every month-scoped figure is measured in. */
export function dashboardMonth(raw: string | undefined, now: Date = new Date()): string {
  if (raw && isValidMonth(raw)) return raw;
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// Whole days from today to `date`, both taken as calendar dates — so "today" is
// 0 and tomorrow is 1 regardless of the hour the page is opened. Deliberately
// not a millisecond division on raw timestamps, which puts a FAT eight hours
// away at "0 days" in the morning and "1 day" in the evening.
function daysUntilDate(isoDate: string, today: Date): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return Number.NaN;
  const target = Date.UTC(y, m - 1, d);
  const base = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - base) / 86_400_000);
}

function pct(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 1000) / 10;
}

// One FAT per (job, date, kind), even when two Scheduler schedules or two
// differently-named tasks describe it. Live data has both: job 1138 carries
// "FAT" and "1138 - Shade-O-Matic FAT" on 2026-08-19, and jobs 1101/1153 each
// have more than one schedule. Collapsing them is what stops "FATs this month"
// double-counting one event; the surviving row keeps its schedule name, so a
// genuinely duplicated schedule is still visible on the list rather than hidden.
function dedupeFats(events: SchedulerFatEvent[]): SchedulerFatEvent[] {
  const seen = new Map<string, SchedulerFatEvent>();
  for (const e of events) {
    const key = `${e.jobNumber}|${e.date}|${e.kind}`;
    const prior = seen.get(key);
    // Prefer the row that names a person — it is the one worth showing.
    if (!prior || (!prior.assignee && e.assignee)) seen.set(key, e);
  }
  return [...seen.values()];
}

export async function getDashboardOverview(month: string, now: Date = new Date()): Promise<DashboardOverview> {
  const [year, monthNo] = month.split("-").map(Number);
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [jobs, employees, hoursRows, fatEvents, owners, visits, utilization] = await Promise.all([
    // The whole live job population in one read (a few hundred rows). Active and
    // HeadStart are split in memory rather than by two counts, so the KPI, the
    // type strip and the customer cards are provably the same set of jobs.
    prisma.job.findMany({
      where: { status: { in: ["Active", "HeadStart"] }, ...validJobTypeFilter },
      select: { jobId: true, jobName: true, customer: true, type: true, status: true },
    }),
    prisma.employee.findMany({
      where: { active: true },
      select: { team: true, department: true, discipline: true },
    }),
    // Actual hours booked in the month, by the stored punch classification — the
    // same `standardDepartment` column the Hours pages group by. Filtered on the
    // denormalised `month`, so this is one grouped scan, not a per-card query.
    prisma.jobHoursDetail.groupBy({
      by: ["standardDepartment"],
      where: { month },
      _sum: { hours: true },
    }),
    fetchSchedulerFatEvents(),
    fetchSchedulerJobDisciplineOwners(),
    getCustomerVisits(month),
    // Punch-grain, so it does its own reads rather than reusing the grouped
    // `hoursRows` above — but it is one awaited unit inside THIS pass, not a
    // fetch the card makes for itself. The one-data-pass rule is about the page
    // never firing per-card requests, not about forbidding a second query.
    getDepartmentUtilization(month),
  ]);

  const activeJobs = jobs.filter((j) => j.status === "Active");
  const headStartTotal = jobs.filter((j) => j.status === "HeadStart").length;
  const activeTotal = activeJobs.length;

  // Every valid type gets a row even at zero, so the strip's shape doesn't change
  // as work moves between types — and the rows provably sum to activeTotal,
  // because the query already restricted `type` to this same list.
  const byType: JobTypeBreakdown[] = VALID_JOB_TYPES.map((type) => {
    const count = activeJobs.filter((j) => j.type === type).length;
    return { type, count, pct: pct(count, activeTotal) };
  });

  // Customers, grouped on the customer string EXACTLY as stored. No fuzzy
  // merging: the Projects page groups the same way, so the cards reconcile
  // against it, and a spelling rule invented here would be a second definition
  // of "who the customer is" living only on the dashboard. (The stored data does
  // contain near-duplicate spellings — a data-quality question for the Projects
  // page's Customer field, not something to paper over with a number nobody can
  // trace back to a row.)
  const byCustomer = new Map<string, typeof activeJobs>();
  for (const j of activeJobs) {
    const name = j.customer?.trim() || "No customer set";
    const list = byCustomer.get(name) ?? [];
    list.push(j);
    byCustomer.set(name, list);
  }
  const customers: CustomerSummary[] = [...byCustomer.entries()]
    .map(([name, list]) => ({
      name,
      internal: isSdcCustomer(name),
      activeCount: list.length,
      byType: VALID_JOB_TYPES.map((type) => {
        const count = list.filter((j) => j.type === type).length;
        return { type, count, pct: pct(count, list.length) };
      }).filter((t) => t.count > 0),
      jobIds: list.map((j) => j.jobId).sort(compareJobIds),
    }))
    // Most active work first; real customers ahead of SDC's own internal jobs at
    // equal counts, since the section is about customer work.
    .sort(
      (a, b) =>
        b.activeCount - a.activeCount || Number(a.internal) - Number(b.internal) || a.name.localeCompare(b.name),
    );

  // ── Workforce cards ───────────────────────────────────────────────────────
  //
  // Headcount runs the Employees tab's own chain — resolveEmployeeGroup gives a
  // department CARD key, workforceGroupForCardKey maps it to a workforce group,
  // rollupGroup credits General Engineering to Engineering — so a mapping change
  // there moves this card too, and there is no second department table here.
  const teamCounts = new Map<string, { name: string; count: number; group: string }>();
  for (const e of employees) {
    const group = resolveEmployeeGroup(e);
    if (!group) continue;
    const wf = rollupGroup(workforceGroupForCardKey(group.key));
    const row = teamCounts.get(group.key) ?? { name: group.title, count: 0, group: wf };
    row.count += 1;
    teamCounts.set(group.key, row);
  }

  const bookedByDept = new Map(hoursRows.map((r) => [r.standardDepartment, Number(r._sum.hours ?? 0)]));
  // "No punch rows for this month at all" is a different thing from "zero hours
  // in this department", and only the first justifies hiding the figure. A future
  // month has no rows; a month that has been worked always has some.
  const monthHasHours = hoursRows.length > 0;
  const capacityPerHead = hasYearPolicy(year) ? monthlyCapacityHours(year, monthNo) : null;

  const workforce: WorkforceCard[] = (["engineering", "shop"] as const).map((key) => {
    const teams = [...teamCounts.entries()]
      .filter(([, v]) => v.group === key)
      .map(([code, v]) => ({ code, name: v.name, count: v.count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const headcount = teams.reduce((s, t) => s + t.count, 0);
    return {
      key,
      title: key === "engineering" ? "Engineering" : "Shop",
      headcount,
      capacityHours: capacityPerHead == null ? null : Math.round(headcount * capacityPerHead),
      // `standardDepartment` uses the same two words — "Engineering" / "Shop" —
      // as the workforce groups, which is why no translation table is needed.
      bookedHours: monthHasHours
        ? Math.round(bookedByDept.get(key === "engineering" ? "Engineering" : "Shop") ?? 0)
        : null,
      teams,
    };
  });

  // ── FATs ──────────────────────────────────────────────────────────────────
  const jobByNumber = new Map(jobs.map((j) => [j.jobId, j]));
  const available = fatEvents !== null;
  const rows: FatRow[] = dedupeFats(fatEvents ?? [])
    .map((e) => {
      const job = jobByNumber.get(e.jobNumber);
      return {
        taskId: e.taskId,
        jobNumber: e.jobNumber,
        jobName: job?.jobName ?? null,
        customer: job?.customer ?? null,
        project: e.project,
        taskName: e.name,
        date: e.date,
        daysUntil: daysUntilDate(e.date, now),
        kind: e.kind,
        assignee: e.assignee,
        meOwners: owners.me.get(e.jobNumber) ?? [],
        ceOwners: owners.controls.get(e.jobNumber) ?? [],
      };
    })
    // Only FATs on jobs this app still considers live work. That keeps stale and
    // test schedules ("1101_Steris_Test") out of a count managers act on, and it
    // ties the FAT figures to the same population the rest of the page reports —
    // so "FATs this month" cannot describe jobs the Active Jobs KPI has never
    // heard of.
    .filter((r) => jobByNumber.has(r.jobNumber))
    .sort((a, b) => a.date.localeCompare(b.date) || compareJobIds(a.jobNumber, b.jobNumber));

  const monthRows = rows.filter((r) => r.date.startsWith(`${month}-`));
  const monthFats = monthRows.filter((r) => r.kind === "fat");

  return {
    month,
    isCurrentMonth: month === currentMonthKey,
    monthInFuture: month > currentMonthKey,
    activeTotal,
    headStartTotal,
    byType,
    customers,
    fats: {
      available,
      // Today counts as upcoming — a FAT happening this morning is the most
      // relevant row on the page, not a past one.
      upcoming: rows.filter((r) => r.daysUntil >= 0),
      monthTotal: monthFats.length,
      monthWithMe: monthFats.filter((r) => r.meOwners.length > 0).length,
      monthWithCe: monthFats.filter((r) => r.ceOwners.length > 0).length,
      monthPreFats: monthRows.filter((r) => r.kind === "pre").length,
      monthUnstaffed: monthFats.filter((r) => r.meOwners.length === 0 && r.ceOwners.length === 0).length,
      monthRows,
    },
    workforce,
    visits,
    utilization,
  };
}
