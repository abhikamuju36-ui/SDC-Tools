import { prisma } from "@/lib/prisma";
import { PageTitle } from "@/components/ui/Typography";
import { card } from "@/components/ui/classnames";
import { JobHoursDashboard } from "@/components/JobHoursDashboard";
import { JobSelect } from "@/components/JobSelect";
import { listDashboardJobs, getJobHoursDashboard, defaultDashboardJobId } from "@/lib/job-hours-dashboard";
import { getJobPartsCost, type JobPartsCost } from "@/lib/sync-totaleto";
import { PartsCostSummary } from "@/components/PartsCostSummary";
import { computePartsBudgetProjection, type PartsBudgetProjection } from "@/lib/parts-budget-projection";
import { SchedulerJobLink } from "@/components/SchedulerJobLink";
import { getSchedulerLinkContext } from "@/lib/scheduler-link";
import { getJobBom, type JobBom } from "@/lib/job-bom";
import { JobProcurement } from "@/components/JobProcurement";
import { EmptyState } from "@/components/ui/EmptyState";

// "Job Hour Details" — web recreation of the Power BI "Job Hours Report —
// Management Level" drillthrough. Supports one OR many jobs (aggregated), like
// the report's job slicer. Selected jobs travel in ?jobs=<jobId,jobId,…>.
export default async function JobHoursPage({
  searchParams,
}: {
  searchParams: Promise<{ jobs?: string; job?: string }>;
}) {
  const { jobs: jobsParam, job: legacyJobParam } = await searchParams;
  const jobs = await listDashboardJobs();
  const idByJobId = new Map(jobs.map((j) => [j.jobId, j.id]));

  // Selected Job Ids (e.g. "1135,1136"). Falls back to the legacy single ?job=
  // (internal id) param, then to the data-rich default.
  let selectedJobIds = (jobsParam ?? "").split(",").map((s) => s.trim()).filter((s) => idByJobId.has(s));
  if (selectedJobIds.length === 0 && legacyJobParam) {
    const j = jobs.find((x) => x.id === Number(legacyJobParam));
    if (j) selectedJobIds = [j.jobId];
  }
  if (selectedJobIds.length === 0) {
    const def = await defaultDashboardJobId();
    const j = jobs.find((x) => x.id === def);
    if (j) selectedJobIds = [j.jobId];
  }
  const selectedInternalIds = selectedJobIds.map((s) => idByJobId.get(s)!).filter((n) => n != null);
  const data = selectedInternalIds.length ? await getJobHoursDashboard(selectedInternalIds) : null;

  // "Open in Scheduler" icon target + which jobs have a Scheduler project
  // (fail-soft empty set when its DB isn't configured).
  const { baseUrl: schedulerBaseUrl, jobNumbers: schedulerJobNumbers } = await getSchedulerLinkContext();

  // Parts lines — live from TotalETO — aggregated across every selected job.
  // Feeds the Procurement Parts List (joined to the BOM by part number).
  // Best-effort: a TotalETO hiccup must not take down the hours dashboard.
  let parts: JobPartsCost | null = null;
  let partsProjection: PartsBudgetProjection | null = null;
  let partsBudget: number | null = null;
  if (data) {
    try {
      const perJob = await Promise.all(data.jobRefs.map((r) => getJobPartsCost(r.jobId).catch(() => null)));
      const lines = perJob.filter(Boolean).flatMap((r) => r!.lines);
      lines.sort((a, b) => (b.purchaseDate ?? "").localeCompare(a.purchaseDate ?? ""));
      const purchased = lines.reduce((s, l) => s + l.totalPrice, 0);
      const paid = lines.reduce((s, l) => s + l.invoicedAmount, 0);
      parts = { purchased, paid, leftToPay: purchased - paid, lines };
      // "Part Cost Budget Projection" — purchased + estimate-to-purchase, the
      // latter being the Parts New ETC for the latest ETC month (see
      // parts-budget-projection.ts for why that field IS Dan's estimate to
      // purchase). Best-effort like the parts pull above; a failure drops the bar.
      partsProjection = await computePartsBudgetProjection(
        data.jobRefs.map((r) => r.id),
        lines,
        data.kpis.latestEtcMonth,
      ).catch(() => null);
    } catch {
      parts = null;
    }
    // "Part Cost Budget" — the report's [Part Cost Quoted] measure is
    // SUM('Cost Estimated'[Cost Quoted]), and that same upstream table populates
    // Job.costQuoted here (syncQuotedFromPowerBi reads EVALUATE 'Cost Estimated'),
    // so summing it across the selected jobs is the same number.
    try {
      const rows = await prisma.job.findMany({
        where: { id: { in: data.jobRefs.map((r) => r.id) } },
        select: { costQuoted: true },
      });
      const total = rows.reduce((s, j) => s + Number(j.costQuoted ?? 0), 0);
      partsBudget = total > 0 ? total : null; // no quote on file → hide the budget bar
    } catch {
      partsBudget = null;
    }
  }

  // Job Cost — the BOM cost hierarchy (formerly its own page) now lives below
  // Parts Cost here. It's a per-single-job view, so only load it when exactly
  // one job is selected. Best-effort: a Power BI hiccup mustn't break the page.
  let bom: JobBom | null = null;
  let bomFailed = false;
  const singleJobId = selectedJobIds.length === 1 ? selectedJobIds[0] : null;
  if (data && singleJobId) {
    try {
      bom = await getJobBom(singleJobId);
    } catch (e) {
      console.error(`getJobBom failed for job ${singleJobId}:`, e);
      bomFailed = true;
    }
  }

  return (
    <div className="w-full p-6 md:p-8">
      <div className="mb-1 flex flex-wrap items-end justify-between gap-4">
        <PageTitle>Job Hour Details</PageTitle>
        <div className="flex items-center gap-2">
          <span className="text-xs text-sdc-gray-500">Job</span>
          {/* Single-job picker. A ?jobs=a,b deep link still aggregates below —
              the control just shows the first of them as the current job. */}
          <JobSelect jobs={jobs} selected={selectedJobIds[0] ?? null} />
        </div>
      </div>
      <p className="mb-5 text-sm text-sdc-gray-600">
        Quoted vs actual vs estimate-to-complete hours by section and billing group, per job.
      </p>

      {data ? (
        <>
          <div className={`${card("p-4")} mb-5`}>
            {selectedJobIds.length > 1 ? (
              // Aggregate mode: the charts/KPIs below sum every selected job, so
              // the header must say so rather than name a single job.
              <>
                <p className="text-lg font-semibold text-sdc-navy">{selectedJobIds.length} jobs (aggregated)</p>
                <p className="text-xs text-sdc-gray-500" title={selectedJobIds.join(", ")}>
                  {selectedJobIds.join(", ")}
                </p>
              </>
            ) : (
              <>
                <p className="flex items-center gap-2 text-lg font-semibold text-sdc-navy">
                  <span>{data.job.jobId} — {data.job.jobName}</span>
                  <SchedulerJobLink
                    jobId={data.job.jobId}
                    jobName={data.job.jobName}
                    baseUrl={schedulerBaseUrl}
                    available={schedulerJobNumbers.has(data.job.jobId)}
                    className="shrink-0 text-sdc-gray-400 hover:text-sdc-blue"
                  />
                </p>
                <p className="text-xs text-sdc-gray-500">
                  {data.job.customer ?? "—"} · {data.job.status}
                </p>
              </>
            )}
          </div>
          <JobHoursDashboard data={data} />

          {/* Parts Cost money summary — sits between the hours charts above and
              the Procurement drawer below, so the page reads hours → parts $ →
              part-level detail. */}
          {parts && (
            <PartsCostSummary
              purchased={parts.purchased}
              paid={parts.paid}
              estimated={partsBudget}
              budgetProjection={partsProjection}
              budget={partsBudget}
            />
          )}

          {/* Procurement — the two-tab (Assemblies / Parts List) drawer ported
              from the Build Readiness app. It's a per-single-job view (BOM tree +
              live PO purchase lines), so it only renders for one selected job. */}
          <div className="mt-8">
            <p className="mb-3 font-heading text-lg font-bold tracking-tight text-sdc-navy">Procurement</p>
            <p className="mb-4 text-sm text-sdc-gray-600">
              Assembly readiness and the full parts buy-list — assemblies, parts, PO status, suppliers and material cost, pulled live from Total ETO.
            </p>
            {!singleJobId ? (
              <EmptyState title="Select a single job" message="Procurement is per job — pick one job above to see its assemblies and parts list." />
            ) : bomFailed ? (
              <EmptyState
                tone="warning"
                title="Procurement is temporarily unavailable"
                message="The BOM couldn't be loaded from Total ETO / Power BI right now. This is usually a brief upstream hiccup — try again in a moment, or run Sync from the Dashboard."
              />
            ) : bom && bom.roots.length ? (
              <JobProcurement bom={bom} partsLines={parts?.lines ?? []} />
            ) : (
              <EmptyState title="No BOM found for this job" message="This job has no assembly/part records in Total ETO." />
            )}
          </div>
        </>
      ) : (
        <div className={card("p-8")}>
          <p className="text-center text-sdc-gray-500">No job data available.</p>
        </div>
      )}
    </div>
  );
}
