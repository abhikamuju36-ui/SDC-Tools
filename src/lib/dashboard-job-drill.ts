import "server-only";
import { prisma } from "@/lib/prisma";
import { ACTIVE_JOB_WHERE, NO_CUSTOMER, compareJobIds } from "@/lib/job-filters";
import { fetchSchedulerFatEvents, fetchSchedulerJobDisciplineOwners } from "@/lib/scheduler-db";

// ── The Dashboard's inline job drill-through (2026-08-28) ───────────────────
//
// Behind a click on a bar in "Active Jobs by Customer" or "Active Jobs by
// Project Type": the actual jobs that bar counted, opened in a panel under the
// chart rather than by navigating to /jobs.
//
// ── Why the count cannot drift from the bar ─────────────────────────────────
//
// The single risk with a drill-through is that it answers a slightly different
// question from the number it hangs off, so the bar says 12 and the table shows
// 11. That is prevented structurally, not by care: the job universe here is
// ACTIVE_JOB_WHERE (job-filters.ts) — literally the same exported constant
// dashboard-overview.ts builds its `activeJobs` array from — plus exactly one
// additional equality on customer or type, which is the same field the chart
// grouped on. There is no second notion of "active" to get out of step.
//
// Customer matching in particular is the STORED STRING, exactly as the chart
// groups it. The book really does contain "FIRST SOLAR, INC.", "FIRST SOLAR
// INC." and "First Solar Inc." as separate customers; merging them here (but
// not in the chart) would make a bar of 12 open a table of 19.
//
// ── Fetched on click, not shipped with the page ─────────────────────────────
//
// Same reasoning as every other drill in this app (tm-drill-actions,
// hours-detail-actions, cash-flow-drill-actions): the enrichment below is two
// extra database reads plus two Scheduler reads, and 26 customers x that is a
// lot of work for the one panel a session actually opens. The client caches
// each result for the session, so re-opening a bar is free.

/** What the panel is currently showing. `value` is the customer string or the type name. */
export type JobDrillFilter = { kind: "customer" | "type"; value: string };

export type JobDrillRow = {
  jobId: string;
  jobName: string;
  customer: string;
  type: string;
  status: string;
  /** PO start, else the planned start. ISO date, or null when neither is set. */
  startDate: string | null;
  /** Earliest FAT the Scheduler has for this job, ISO. Null when the Scheduler has none or is unreachable. */
  fatDate: string | null;
  /** Named mech / controls engineers on the job's Scheduler tasks. This app carries no PM field. */
  meOwners: string[];
  ceOwners: string[];
  /** Σ EstimatedHours for the job. Null when the job has no estimate rows at all — not 0, which would read as "quoted nothing". */
  quotedHours: number | null;
  actualHours: number | null;
  etcHours: number | null;
};

export type JobDrillResult = {
  filter: JobDrillFilter;
  rows: JobDrillRow[];
  /** True when the Scheduler was unreachable, so the UI can say that instead of showing empty FAT cells as fact. */
  schedulerAvailable: boolean;
};

const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/**
 * The chart's own bucket label for a job — the SAME expression
 * dashboard-overview.ts groups customers by. Exported so the two cannot drift.
 */
export function customerBucket(customer: string | null): string {
  return customer?.trim() || NO_CUSTOMER;
}

export async function fetchActiveJobDrill(filter: JobDrillFilter): Promise<JobDrillResult> {
  // ── Why the customer match is NOT done in SQL (2026-08-28) ────────────────
  //
  // It was, as `where: { customer: filter.value }`, and it silently over-matched:
  // MySQL's default collation is case- and trailing-space-insensitive, so
  // `customer = 'FIRST SOLAR, INC.'` also returned the rows stored as
  // 'First Solar, Inc.' and 'First Solar Inc.'. The chart groups in JS, which is
  // case-SENSITIVE, so it draws those as three separate bars — and a 12-bar
  // opened a 13-row table. Across the whole book the drill returned 79 rows for
  // 59 active jobs.
  //
  // Rather than reach for a COLLATE clause (which needs raw SQL and leaves the
  // same trap set for the next filter added here), the row set is now narrowed
  // in JS using customerBucket() — literally the function the chart groups by.
  // The grouping cannot disagree with itself. The cost is reading the active job
  // list rather than one customer's slice, which is ~59 rows on today's book and
  // the same read the Dashboard already does for the charts themselves.
  const all = await prisma.job.findMany({
    where: ACTIVE_JOB_WHERE,
    select: {
      id: true,
      jobId: true,
      jobName: true,
      customer: true,
      type: true,
      status: true,
      poStartDate: true,
      startDate: true,
    },
  });

  const jobs =
    filter.kind === "type"
      ? all.filter((j) => j.type === filter.value)
      : all.filter((j) => customerBucket(j.customer) === filter.value);

  if (jobs.length === 0) {
    return { filter, rows: [], schedulerAvailable: true };
  }

  const [hours, fatEvents, owners] = await Promise.all([
    prisma.estimatedHours.groupBy({
      by: ["jobId"],
      where: { jobId: { in: jobs.map((j) => j.id) } },
      _sum: { quotedHours: true, actualHistoricalHours: true, estimateToCompleteHours: true },
    }),
    fetchSchedulerFatEvents(),
    fetchSchedulerJobDisciplineOwners(),
  ]);

  const hoursByJob = new Map(hours.map((h) => [h.jobId, h._sum]));

  // Earliest real FAT per job. Pre-FATs are excluded for the same reason the
  // Dashboard's FAT KPI excludes them — a pre-FAT is a rehearsal, not the date
  // anybody plans around.
  const fatByJob = new Map<string, string>();
  for (const e of fatEvents ?? []) {
    if (e.kind !== "fat") continue;
    const prior = fatByJob.get(e.jobNumber);
    if (!prior || e.date < prior) fatByJob.set(e.jobNumber, e.date);
  }

  const rows: JobDrillRow[] = jobs.map((j) => {
    const h = hoursByJob.get(j.id);
    const num = (v: unknown): number | null => (v == null ? null : Number(v));
    return {
      jobId: j.jobId,
      jobName: j.jobName,
      customer: customerBucket(j.customer),
      type: j.type ?? "—",
      status: j.status,
      startDate: iso(j.poStartDate ?? j.startDate),
      fatDate: fatByJob.get(j.jobId) ?? null,
      meOwners: owners.me.get(j.jobId) ?? [],
      ceOwners: owners.controls.get(j.jobId) ?? [],
      quotedHours: num(h?.quotedHours),
      actualHours: num(h?.actualHistoricalHours),
      etcHours: num(h?.estimateToCompleteHours),
    };
  });

  rows.sort((a, b) => compareJobIds(a.jobId, b.jobId));

  return { filter, rows, schedulerAvailable: fatEvents !== null };
}
