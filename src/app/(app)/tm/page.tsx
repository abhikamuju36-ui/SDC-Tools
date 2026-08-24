import { PageTitle } from "@/components/ui/Typography";
import { requirePagePermission } from "@/lib/require-permission";
import { listDashboardJobs } from "@/lib/job-hours-dashboard";
import { fetchTmMetrics, fetchTmDateDefaults, type TmMetrics, type TmPartsMetrics } from "@/lib/tm-report";
import { getTmHoursTotals, type TmHoursTotals } from "@/lib/tm-hours";
import { resolveTmDateRange } from "@/lib/tm-drill-validate";
import { TmReportClient } from "@/components/TmReportClient";

// "T&M" — native recreation of the Power BI "Job Hours Report - Management
// Level" report's own "T&M" page, for its three dollar cards (see
// src/lib/tm-report.ts for the exact field → measure mapping — those still
// come from a live Power BI query). The four Hours cards read the app's own
// local Paylocity ingest instead (src/lib/tm-hours.ts) — the same pipeline
// Monthly ETC's own hours already use, per explicit request (2026-08-19).
export default async function TmPage({
  searchParams,
}: {
  searchParams: Promise<{ jobs?: string; start?: string; end?: string }>;
}) {
  await requirePagePermission("tm:view");
  const { jobs: jobsParam, start, end } = await searchParams;

  const [jobs, dateDefaults] = await Promise.all([listDashboardJobs(), fetchTmDateDefaults()]);
  const idByJobId = new Set(jobs.map((j) => j.jobId));

  const selectedJobIds = (jobsParam ?? "").split(",").map((s) => s.trim()).filter((s) => idByJobId.has(s));

  // The same "empty selection = All Jobs" convention buildTmFilters() uses
  // for the Power BI path — an empty selectedJobIds resolves to every job's
  // PK here too, not zero.
  const jobPks = (selectedJobIds.length > 0 ? jobs.filter((j) => selectedJobIds.includes(j.jobId)) : jobs).map((j) => j.id);

  // With nothing in the URL yet, the window matches the Power BI page's own
  // reporting window: [Estimated to Complete As Of Date] -> [Hours Refreshed
  // Thru]. (Described here as "a 90-day window" until 2026-08-24 — it never was;
  // it is whatever those two measures happen to be, currently a two-month span.)
  // That ETC-derived START is the only ETC thing about this filter: the range is
  // applied to transaction and work dates, never to ETC months — which is why the
  // input labels no longer say "ETC".
  const fallbackEnd = dateDefaults.hoursRefreshedThru ?? new Date().toISOString().slice(0, 10);
  const fallbackStart = dateDefaults.asOfDate ?? fallbackEnd;

  // Real calendar validation, one endpoint independent of the other, and an
  // inverted range read in the order that can match records — see
  // resolveTmDateRange's own header for the two bugs this replaced.
  const { startDate, endDate } = resolveTmDateRange(start, end, fallbackStart, fallbackEnd);

  // Two independent sources, two independent failure modes: a Power BI outage
  // shouldn't blank out hours that a local database read already has, and
  // vice versa. Only an HOURS failure blocks the whole page (matching the old
  // single-error behavior) — hours failing means something's wrong with the
  // app's own database, which is a lot more serious than the dollar cards'
  // Power BI connection having a bad moment.
  let hoursTotals: TmHoursTotals | null = null;
  let hoursError: string | null = null;
  try {
    hoursTotals = await getTmHoursTotals(jobPks, startDate, endDate);
  } catch (err) {
    hoursError = err instanceof Error ? err.message : "Could not read hours data.";
  }

  let partsMetrics: TmPartsMetrics | null = null;
  let partsError: string | null = null;
  try {
    partsMetrics = await fetchTmMetrics({ jobIds: selectedJobIds, startDate, endDate });
  } catch (err) {
    partsError = err instanceof Error ? err.message : "Could not reach Power BI.";
  }

  const metrics: TmMetrics | null = hoursTotals
    ? {
        jobDisplay: partsMetrics?.jobDisplay ?? "",
        partInvoicedAmount: partsMetrics?.partInvoicedAmount ?? 0,
        sdcManufacturedPartsSalesPrice: partsMetrics?.sdcManufacturedPartsSalesPrice ?? 0,
        expenseReports: partsMetrics?.expenseReports ?? 0,
        ...hoursTotals,
      }
    : null;

  return (
    <div className="w-full p-8">
      <PageTitle className="mb-1">T&M</PageTitle>
      <p className="mb-6 max-w-2xl text-sm text-sdc-gray-600">
        Time &amp; materials summary for a job (or every job), over a date range — Hours read from the app&apos;s own
        Paylocity data (the same source Monthly ETC uses); Part Invoiced Amount, SDC Manufactured Parts Sales Price and
        Expense Reports read live from the same Power BI measures as the &quot;T&amp;M&quot; page in Job Hours Report -
        Management Level.
      </p>
      <TmReportClient
        jobs={jobs}
        selectedJobIds={selectedJobIds}
        startDate={startDate}
        endDate={endDate}
        metrics={metrics}
        hoursError={hoursError}
        partsError={partsError}
      />
    </div>
  );
}
