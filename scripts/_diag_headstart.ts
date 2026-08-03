import { prisma } from "../src/lib/prisma";
import { etcActiveJobFilter } from "../src/lib/job-filters";
import { PARTS_COST_SECTION } from "../src/lib/sections";

const MONTH = "2026-07";

async function main() {
  const statuses = await prisma.job.groupBy({ by: ["status"], _count: { _all: true } });
  console.log("job statuses:", statuses.map((s) => `${s.status ?? "(null)"}=${s._count._all}`).join("  "));

  const types = await prisma.job.groupBy({ by: ["type"], _count: { _all: true } });
  console.log("job types:", types.map((s) => `${s.type ?? "(null)"}=${s._count._all}`).join("  "));

  // What the grid renders.
  const rendered = await prisma.job.findMany({ where: etcActiveJobFilter, select: { id: true } });
  const renderedIds = new Set(rendered.map((r) => r.id));
  console.log(`\ngrid renders ${renderedIds.size} jobs (etcActiveJobFilter)`);

  // Every HeadStart-ish job, and whether it has July entries / hours.
  const head = await prisma.job.findMany({
    where: { status: { contains: "head" } },
    select: {
      id: true, jobId: true, jobName: true, status: true, type: true, billable: true, completeDate: true,
      etcEntries: { where: { month: MONTH }, select: { section: true, hoursWorked: true } },
    },
  });
  console.log(`\njobs with a HeadStart-like status: ${head.length}`);
  for (const j of head) {
    const hourRows = j.etcEntries.filter((e) => e.section !== PARTS_COST_SECTION);
    const hours = hourRows.reduce((s, e) => s + Number(e.hoursWorked), 0);
    const withHours = hourRows.filter((e) => Number(e.hoursWorked) > 0).length;
    console.log(
      `  ${j.jobId} ${j.jobName?.slice(0, 34)} | status=${j.status} type=${j.type} billable=${j.billable} | ` +
        `julyRows=${hourRows.length} rowsWithHours=${withHours} hours=${Math.round(hours * 100) / 100} | ` +
        `inGrid=${renderedIds.has(j.id)} | ALREADY IN OFF-GRID=${!renderedIds.has(j.id) && withHours > 0}`,
    );
  }

  // What the off-grid panel currently lists.
  const renderedArr = [...renderedIds];
  const offGrid = await prisma.etcEntry.findMany({
    where: { month: MONTH, hoursWorked: { gt: 0 }, jobId: { notIn: renderedArr }, section: { not: PARTS_COST_SECTION } },
    select: { hoursWorked: true, job: { select: { jobId: true, jobName: true, status: true, type: true, billable: true } } },
  });
  const byJob = new Map<string, { status: string | null; type: string | null; billable: boolean; hours: number; name: string }>();
  for (const e of offGrid) {
    const k = e.job.jobId;
    const cur = byJob.get(k) ?? { status: e.job.status, type: e.job.type, billable: e.job.billable, hours: 0, name: e.job.jobName ?? "" };
    cur.hours += Number(e.hoursWorked);
    byJob.set(k, cur);
  }
  console.log(`\noff-grid panel currently lists ${byJob.size} jobs:`);
  for (const [k, v] of byJob) console.log(`  ${k} ${v.name.slice(0, 30)} | status=${v.status} type=${v.type} billable=${v.billable} | ${Math.round(v.hours)}h`);

  await prisma.$disconnect();
}

main();
