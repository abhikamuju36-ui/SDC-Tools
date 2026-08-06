import { prisma } from "@/lib/prisma";
import { PageTitle } from "@/components/ui/Typography";
import { card } from "@/components/ui/classnames";
import { JobHoursDashboard } from "@/components/JobHoursDashboard";
import { IndicatorCard } from "@/components/charts/IndicatorCard";
import { JobSelect } from "@/components/JobSelect";
import { listDashboardJobs, getJobHoursDashboard, defaultDashboardJobId } from "@/lib/job-hours-dashboard";
import { getJobPartsCost, type JobPartsCost } from "@/lib/sync-totaleto";
import { computePartsBudgetProjection, type PartsBudgetProjection } from "@/lib/parts-budget-projection";
import { SchedulerJobLink } from "@/components/SchedulerJobLink";
import { getSchedulerLinkContext } from "@/lib/scheduler-link";
import { getJobBom, type JobBom } from "@/lib/job-bom";
import { getJobHoursDetail, type JobHoursDetail } from "@/lib/job-hours-detail";
import { JobProcurement } from "@/components/JobProcurement";
import { EmptyState } from "@/components/ui/EmptyState";

// No-job-selected placeholder, so the dashboard's prop stays non-nullable and
// the panel has one shape to render.
const EMPTY_HOURS_DETAIL: JobHoursDetail = { rows: [], total: 0, sections: [], truncated: false };

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
  // Present-but-empty `?jobs=` means the user cleared the picker deliberately.
  // Absent means they've simply arrived. Only the second gets a default job —
  // treating them alike is what made "remove the last job" impossible before,
  // since the server re-picked one the instant the param went away.
  const explicitlyEmpty = jobsParam !== undefined && jobsParam.trim() === "";
  if (selectedJobIds.length === 0 && !explicitlyEmpty) {
    const def = await defaultDashboardJobId();
    const j = jobs.find((x) => x.id === def);
    if (j) selectedJobIds = [j.jobId];
  }
  const selectedInternalIds = selectedJobIds.map((s) => idByJobId.get(s)!).filter((n) => n != null);
  const data = selectedInternalIds.length ? await getJobHoursDashboard(selectedInternalIds) : null;

  // Punch-level hours for the drill-through panel. Straight from the app's own
  // MySQL (populated by the hours sync), so it costs one indexed query and can't
  // disagree with the section totals above it. Empty when nothing's ingested yet
  // — the panel says so rather than looking broken.
  const hoursDetail = data ? await getJobHoursDetail(data.jobRefs.map((r) => r.id)) : EMPTY_HOURS_DETAIL;

  // "Open in Scheduler" icon target + which jobs have a Scheduler project
  // (fail-soft empty set when its DB isn't configured).
  const { baseUrl: schedulerBaseUrl, jobNumbers: schedulerJobNumbers, ssoEmail: schedulerSsoEmail } = await getSchedulerLinkContext();

  // Parts lines — live from TotalETO — aggregated across every selected job.
  // Feeds the Parts Cost card, and (single job only) the Procurement Parts List.
  //
  // The Parts Cost MONEY totals aggregate correctly across jobs, so they follow
  // the selection. The Procurement drawer below does not — a BOM tree is per job
  // — and stays single-job.
  //
  // Two things this has to be careful about with many jobs selected:
  //  • It's one live TotalETO call PER JOB, so a large selection is a lot of
  //    upstream round trips. Capped, with the card saying so rather than
  //    quietly showing a partial figure.
  //  • A single job's call failing used to be swallowed, and its lines simply
  //    dropped out of the total — a $0 bar that looks like "nothing bought yet"
  //    but actually means "we couldn't ask". Failures are counted now and shown.
  const isMulti = selectedJobIds.length > 1;
  const singleJobId = selectedJobIds.length === 1 ? selectedJobIds[0] : null;
  const PARTS_MAX_JOBS = 12;
  const partsCapped = !!data && data.jobRefs.length > PARTS_MAX_JOBS;

  let parts: JobPartsCost | null = null;
  let partsProjection: PartsBudgetProjection | null = null;
  let partsBudget: number | null = null;
  let partsFailedJobs = 0;
  if (data && !partsCapped) {
    try {
      const perJob = await Promise.all(
        data.jobRefs.map((r) =>
          getJobPartsCost(r.jobId).then(
            (v) => ({ ok: true as const, v }),
            () => ({ ok: false as const, v: null }),
          ),
        ),
      );
      partsFailedJobs = perJob.filter((r) => !r.ok).length;
      const lines = perJob.flatMap((r) => r.v?.lines ?? []);
      lines.sort((a, b) => (b.purchaseDate ?? "").localeCompare(a.purchaseDate ?? ""));
      const purchased = lines.reduce((s, l) => s + l.totalPrice, 0);
      const paid = lines.reduce((s, l) => s + l.invoicedAmount, 0);
      // Every job failed: show nothing rather than a confident set of $0 bars.
      parts =
        partsFailedJobs === data.jobRefs.length ? null : { purchased, paid, leftToPay: purchased - paid, lines };
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
          <span className="text-xs text-sdc-muted">Jobs</span>
          {/* Multi-job picker. Several jobs aggregate into one set of hours
              charts, the way the Power BI job slicer does. */}
          <JobSelect jobs={jobs} selected={selectedJobIds} />
        </div>
      </div>
      <p className="mb-5 text-sm text-sdc-gray-600">
        Quoted vs actual vs estimate-to-complete hours by section and billing group, per job.
      </p>

      {data ? (
        <>
          {/* Header row (§57): the project-title card and the three summary
              cards on ONE line, all the same height. The title card is wider
              (2fr vs 1fr each) because it holds the most text, but the row
              stays balanced. `items-stretch` (grid default) equalises heights;
              the title card centres its two lines vertically so it fills that
              height without the empty space the old p-4 block wasted. The
              "Eng Design-to-Debug Ratio" card was removed. On narrow screens
              the title spans the full width and the summary cards wrap beneath.
              Below `sm` everything stacks. */}
          <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-[2fr_1fr_1fr_1fr]">
            <div className={`${card("p-3.5")} col-span-2 flex flex-col justify-center lg:col-span-1`}>
              {selectedJobIds.length > 1 ? (
                // Aggregate mode: the charts/KPIs below sum every selected job,
                // so the header must say so rather than name a single job.
                <>
                  <p className="font-heading text-lg font-bold leading-tight tracking-tight text-sdc-navy">
                    {selectedJobIds.length} jobs (aggregated)
                  </p>
                  <p className="mt-0.5 truncate text-xs text-sdc-muted" title={selectedJobIds.join(", ")}>
                    {selectedJobIds.join(", ")}
                  </p>
                </>
              ) : (
                <>
                  <p className="flex items-center gap-2 font-heading text-lg font-bold leading-tight tracking-tight text-sdc-navy">
                    <span className="truncate">{data.job.jobId} — {data.job.jobName}</span>
                    <SchedulerJobLink
                      jobId={data.job.jobId}
                      jobName={data.job.jobName}
                      baseUrl={schedulerBaseUrl}
                      available={schedulerJobNumbers.has(data.job.jobId)}
                      ssoEmail={schedulerSsoEmail}
                      className="shrink-0 text-sdc-gray-400 hover:text-sdc-blue"
                    />
                  </p>
                  <p className="mt-0.5 truncate text-xs text-sdc-muted">
                    {data.job.customer ?? "—"} · {data.job.status}
                  </p>
                </>
              )}
            </div>
            <IndicatorCard label="Active Jobs" value={String(data.kpis.activeJobs)} />
            <IndicatorCard label="Hours Refreshed Thru" value={data.kpis.hoursRefreshedThru ?? "—"} />
            <IndicatorCard label="Latest ETC Month" value={data.kpis.latestEtcMonth ?? "—"} />
          </div>
          {/* Parts Cost joins the two hours charts in one row (§52) — it follows
              the selection like they do: these dollars sum across jobs
              correctly, unlike the BOM below. Below the row, Procurement reads
              hours → parts $ → part-level detail. */}
          <JobHoursDashboard
            data={data}
            hoursDetail={hoursDetail}
            parts={
              parts
                ? {
                    purchased: parts.purchased,
                    paid: parts.paid,
                    estimated: partsBudget,
                    budgetProjection: partsProjection,
                    jobCount: data.jobRefs.length,
                    failedJobs: partsFailedJobs,
                  }
                : null
            }
          />

          {partsCapped && (
            <p className="mt-6 rounded-lg border border-sdc-border bg-sdc-gray-50 px-4 py-3 text-sm text-sdc-gray-600">
              Parts Cost is hidden for selections above 12 jobs — the figures come from one live Total ETO call per job, and a
              selection this size would hammer it for a total nobody reads per job anyway. Narrow the selection to see parts dollars.
            </p>
          )}
          {!partsCapped && !parts && (
            <p className="mt-6 rounded-lg border border-sdc-yellow bg-sdc-yellow-bg px-4 py-3 text-sm text-sdc-yellow-text">
              Parts Cost is unavailable — Total ETO couldn&apos;t be reached for {data.jobRefs.length === 1 ? "this job" : "any of the selected jobs"}.
              This is usually a brief upstream hiccup; the hours above are unaffected.
            </p>
          )}

          {/* Procurement — the two-tab (Assemblies / Parts List) drawer ported
              from the Build Readiness app. It's a per-single-job view (BOM tree +
              live PO purchase lines), so it only renders for one selected job. */}
          {isMulti ? (
            // Hours only. One quiet line rather than a full Procurement heading
            // followed by an empty box — with several jobs selected, parts and
            // procurement aren't unavailable, they're not a sensible question,
            // and a big empty panel implies something failed to load.
            <p className="mt-8 rounded-lg border border-sdc-border bg-sdc-gray-50 px-4 py-3 text-sm text-sdc-gray-600">
              Hours and Parts Cost above are <strong>summed across all {selectedJobIds.length} selected jobs</strong>. Procurement is per-job —
              each job has its own BOM and buy-list — so select a single job to see assemblies and the parts list.
            </p>
          ) : (
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
          )}
        </>
      ) : (
        <div className={card("p-8")}>
          {/* Cleared the picker, rather than "something went wrong" — the page
              can legitimately have nothing selected now. */}
          <EmptyState
            title="No jobs selected"
            message="Pick one or more jobs above. Several jobs aggregate into one set of hours charts; a single job also shows its parts cost and procurement."
          />
        </div>
      )}
    </div>
  );
}
