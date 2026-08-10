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
export default async function JobCostExplorerPage() {
  const [{ rows, inventoryAsOf, etcRefreshedThru, liveEtcByJobId, partsCostAvailable }, { defaults, overrides }, allocations] = await Promise.all([
    loadJobCostRows(),
    loadCostRates(),
    loadHourAllocations(),
  ]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3">
        <PageTitle>Job Cost Explorer</PageTitle>
        <p className="text-note text-sdc-gray-400">Per-job profit and margin — hours and parts cost from this app&apos;s own data</p>
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
        />
      </SuppressToasts>
    </div>
  );
}
