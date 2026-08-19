/**
 * Validates the T&M tab's four Hours cards (Engineering/Shop/PM/Manufacturing)
 * against the retired Power BI `Hours Actual` measure — the "Old PBI T&M
 * result vs new direct-source result" comparison the migration's own task
 * spec asks for. Read-only both sides.
 *
 *   npx tsx --env-file=.env scripts/verify-tm-hours-vs-powerbi.ts
 *
 * Both sides run the SAME classifyTmHoursSection() over a (Job Id, Section
 * code, hours) row — the PBI side via SUMMARIZECOLUMNS grouped by 'Job'[Job
 * Id] + 'Function Hierarchy'[Section-Function Code] (the exact pattern
 * documented in docs/SEMANTIC-MODEL-MAP.md as the one that works around
 * `Hours Actual`'s broken calculated column), the local side via
 * getTmHoursTotals reading JobHoursDetail. If the classifier and the two
 * source tables agree, every scenario below reconciles to the cent... to the
 * hundredth of an hour.
 */
import { prisma } from "../src/lib/prisma";
import { runDax } from "../src/lib/powerbi-client";
import { validJobTypeFilter } from "../src/lib/job-filters";
import { classifyTmHoursSection, ALL_TM_HOURS_CODES, type TmHoursDrillKey } from "../src/lib/tm-hours-classify";
import { mapPunchToColumns } from "../src/lib/sections";

// tm-hours.ts itself can't be value-imported from a plain tsx script — it has
// `import "server-only"`, which throws unconditionally outside a Next.js
// server build (see tm-hours-classify.ts's own header for the same
// constraint on the test suite). So this re-implements getTmHoursTotals'
// exact query inline rather than importing it — same Prisma call, same
// classifier, just not through the server-only module boundary.
type TmHoursTotals = Record<TmHoursDrillKey, number>;

function dateRangeWhere(startDate: string, endDate: string) {
  return { gte: new Date(`${startDate}T00:00:00.000Z`), lte: new Date(`${endDate}T00:00:00.000Z`) };
}

async function resolveTmJobPks(jobIds: string[]): Promise<number[]> {
  const where = jobIds.length > 0 ? { jobId: { in: jobIds }, ...validJobTypeFilter } : validJobTypeFilter;
  const jobs = await prisma.job.findMany({ where, select: { id: true } });
  return jobs.map((j) => j.id);
}

async function getTmHoursTotals(jobPks: number[], startDate: string, endDate: string): Promise<TmHoursTotals> {
  const totals: TmHoursTotals = { engineeringHours: 0, shopHours: 0, pmHours: 0, manufacturingHours: 0 };
  if (jobPks.length === 0) return totals;
  const grouped = await prisma.jobHoursDetail.groupBy({
    by: ["section"],
    where: { jobId: { in: jobPks }, workDate: dateRangeWhere(startDate, endDate), section: { in: [...ALL_TM_HOURS_CODES] } },
    _sum: { hours: true },
  });
  for (const g of grouped) {
    const key = classifyTmHoursSection(g.section);
    if (!key) continue;
    totals[key] += Number(g._sum?.hours ?? 0);
  }
  return totals;
}

function daxDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `DATE(${y},${m},${d})`;
}

const ZERO: TmHoursTotals = { engineeringHours: 0, shopHours: 0, pmHours: 0, manufacturingHours: 0 };

async function pbiTotals(jobIds: string[] | null, startDate: string, endDate: string): Promise<TmHoursTotals> {
  const jobFilter = jobIds ? `FILTER(ALL('Job'[Job Id]), 'Job'[Job Id] IN {${jobIds.map((j) => `"${j}"`).join(",")}})` : `ALL('Job'[Job Id])`;
  const dax = `
EVALUATE
SUMMARIZECOLUMNS(
  'Job'[Job Id], 'Function Hierarchy'[Section-Function Code],
  ${jobFilter},
  FILTER(ALL('Date'[Date]), 'Date'[Date] >= ${daxDate(startDate)} && 'Date'[Date] <= ${daxDate(endDate)}),
  "Hours", SUM('Hours Actual'[Hours Actual])
)`;
  const rows = (await runDax(dax)) as Record<string, unknown>[];
  const totals: TmHoursTotals = { ...ZERO };
  for (const r of rows) {
    const rawCode = String(r["Function Hierarchy[Section-Function Code]"] ?? r["Section-Function Code"] ?? "");
    const rawHours = Number(r["Hours"] ?? 0);
    // PBI's Function Hierarchy carries UNALIASED codes (e.g. raw punches split
    // across 40-211/40-311/40-312/40-313, or 10-414 for manufacturing) — the
    // exact same raw codes mapPunchToColumns() (sections.ts) resolves down to
    // one app column BEFORE a row is ever written to the local JobHoursDetail
    // table. Route PBI's raw rows through the identical alias table so both
    // sides classify the SAME resolved code, not a PBI-only surface form of it.
    for (const { section, hours } of mapPunchToColumns(rawCode, rawHours)) {
      const key = classifyTmHoursSection(section);
      if (!key) continue;
      totals[key] += hours;
    }
  }
  return totals;
}

function fmt(t: TmHoursTotals): string {
  return `eng ${t.engineeringHours.toFixed(2).padStart(9)}  shop ${t.shopHours.toFixed(2).padStart(9)}  pm ${t.pmHours
    .toFixed(2)
    .padStart(8)}  mfg ${t.manufacturingHours.toFixed(2).padStart(9)}`;
}

function diff(a: TmHoursTotals, b: TmHoursTotals): TmHoursTotals {
  return {
    engineeringHours: Math.round((a.engineeringHours - b.engineeringHours) * 100) / 100,
    shopHours: Math.round((a.shopHours - b.shopHours) * 100) / 100,
    pmHours: Math.round((a.pmHours - b.pmHours) * 100) / 100,
    manufacturingHours: Math.round((a.manufacturingHours - b.manufacturingHours) * 100) / 100,
  };
}

function isZero(t: TmHoursTotals): boolean {
  return t.engineeringHours === 0 && t.shopHours === 0 && t.pmHours === 0 && t.manufacturingHours === 0;
}

type Scenario = { label: string; jobIds: string[] | null; startDate: string; endDate: string };

async function main() {
  console.log("Picking representative jobs from the live database…\n");

  const active = await prisma.job.findFirst({ where: { status: "Active" }, orderBy: { id: "asc" }, select: { jobId: true } });
  const complete = await prisma.job.findFirst({ where: { status: "Complete" }, orderBy: { id: "asc" }, select: { jobId: true } });
  const withHours = await prisma.jobHoursDetail.groupBy({ by: ["jobId"], _sum: { hours: true }, orderBy: { _sum: { hours: "desc" } }, take: 3 });
  const topJobs = await prisma.job.findMany({ where: { id: { in: withHours.map((w) => w.jobId) } }, select: { jobId: true, status: true } });
  const zeroHourJob = await prisma.job.findFirst({
    where: { id: { notIn: (await prisma.jobHoursDetail.findMany({ select: { jobId: true }, distinct: ["jobId"] })).map((r) => r.jobId) } },
    select: { jobId: true },
  });

  // Power BI's 'Hours Actual' mirror of Paylocity is known to lag the app's
  // own direct-read ingest by days-to-weeks (docs/SEMANTIC-MODEL-MAP.md: the
  // SharePoint hours sync outage; the whole reason this migration exists).
  // Comparing against "today" would just re-measure that known staleness gap,
  // not validate the classifier/filter logic. So this window ends well before
  // that gap — isolating whether the two sources agree on a period BOTH have
  // fully ingested.
  const wideStart = "2026-03-01";
  const today = "2026-07-15";

  const scenarios: Scenario[] = [];
  if (topJobs[0]) scenarios.push({ label: `single job ${topJobs[0].jobId} (${topJobs[0].status}), 4mo range`, jobIds: [topJobs[0].jobId], startDate: wideStart, endDate: today });
  if (topJobs.length >= 2) scenarios.push({ label: `multiple jobs ${topJobs.map((j) => j.jobId).join(",")}, 4mo range`, jobIds: topJobs.map((j) => j.jobId), startDate: wideStart, endDate: today });
  if (active) scenarios.push({ label: `active job ${active.jobId}, 4mo range`, jobIds: [active.jobId], startDate: wideStart, endDate: today });
  if (complete) scenarios.push({ label: `complete job ${complete.jobId}, 4mo range`, jobIds: [complete.jobId], startDate: wideStart, endDate: today });
  if (zeroHourJob) scenarios.push({ label: `zero-hour job ${zeroHourJob.jobId}, 4mo range`, jobIds: [zeroHourJob.jobId], startDate: wideStart, endDate: today });
  scenarios.push({ label: "all jobs, 4mo range", jobIds: null, startDate: wideStart, endDate: today });

  let anyFail = false;

  for (const s of scenarios) {
    process.stdout.write(`\n${s.label}\n`);
    const jobPks = await resolveTmJobPks(s.jobIds ?? []);
    const [local, pbi] = await Promise.all([getTmHoursTotals(jobPks, s.startDate, s.endDate), pbiTotals(s.jobIds, s.startDate, s.endDate)]);
    const d = diff(local, pbi);
    const ok = isZero(d);
    console.log(`  local: ${fmt(local)}`);
    console.log(`  pbi:   ${fmt(pbi)}`);
    console.log(`  diff:  ${fmt(d)}  ${ok ? "MATCH" : "*** MISMATCH ***"}`);
    if (!ok) anyFail = true;
  }

  console.log(anyFail ? "\nFAIL — at least one scenario diverged.\n" : "\nPASS — every scenario reconciles.\n");
  await prisma.$disconnect();
  process.exit(anyFail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
