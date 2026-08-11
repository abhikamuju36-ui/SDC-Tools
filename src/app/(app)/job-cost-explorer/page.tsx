import { PageTitle } from "@/components/ui/Typography";
import { loadJobCostRows } from "@/lib/job-cost-source";
import { loadCostRates, loadHourAllocations } from "@/lib/job-cost-actions";
import { JobCostExplorer } from "@/components/JobCostExplorer";
import { SuppressToasts } from "@/components/ui/Toast";

// "Job Cost Explorer" — integrated from the standalone app at
// D:\AI Projects\new app. Per-job profit/margin, reusing this app's own job,
// hours, and parts-cost data instead of the standalone app's independent
// Power BI queries — see docs/INTEGRATIONS.md and the DEVLOG entry for the
// full audit of what was reused vs. what still has no equivalent here.
//
// `?asOf=YYYY-MM-DD` (2026-08-11): a month-end snapshot selector. Absent, or
// literally "current", means today's live view (unchanged from before this
// param existed) — anything else re-resolves the whole table (hours, ETC,
// inventory) as of that month-end. See lib/job-cost-source.ts's
// loadJobCostRows for the resolution rules.
export default async function JobCostExplorerPage({ searchParams }: { searchParams: Promise<{ asOf?: string }> }) {
  const { asOf: asOfParam } = await searchParams;
  const asOf = asOfParam && asOfParam !== "current" ? asOfParam : null;

  const [
    { rows, inventoryAsOf, etcRefreshedThru, liveEtcByJobId, partsCostAvailable, asOf: appliedAsOf, inventoryMissing, etcMissing, asOfOptions },
    { defaults, overrides },
    allocations,
  ] = await Promise.all([loadJobCostRows(asOf), loadCostRates(), loadHourAllocations()]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <PageTitle>Profitability</PageTitle>
        <p className="text-note text-sdc-gray-400">
          Per-job profit and margin — hours and parts cost from this app&apos;s own data
          {/* The active As-of date, stated plainly wherever the page's own
              subtitle already is — "show the active As of date clearly". */}
          {" · "}
          {appliedAsOf ? <>As of <span className="font-semibold text-sdc-navy">{appliedAsOf}</span></> : "Current"}
        </p>
      </div>
      {/* SuppressToasts belongs HERE, wrapping the call site — not inside
          JobCostExplorer.tsx wrapping its own return value. A component cannot
          supply its own useToast() call with a Provider it renders as part of
          its own output: useContext resolves against ANCESTORS at the point the
          hook runs, and a self-wrap is a descendant of that point, not an
          ancestor. This is a server component, so it can render the client
          SuppressToasts wrapper directly, same as any other client child. */}
      <SuppressToasts>
        <JobCostExplorer
          rows={rows}
          defaultRates={defaults}
          yearRateOverrides={overrides}
          hourAllocations={Object.fromEntries(allocations)}
          liveEtcByJobId={Object.fromEntries(liveEtcByJobId)}
          inventoryAsOf={inventoryAsOf}
          etcRefreshedThru={etcRefreshedThru}
          partsCostAvailable={partsCostAvailable}
          asOf={appliedAsOf}
          inventoryMissing={inventoryMissing}
          etcMissing={etcMissing}
          asOfOptions={asOfOptions}
        />
      </SuppressToasts>
    </div>
  );
}
