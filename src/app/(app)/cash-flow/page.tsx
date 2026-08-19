import { PageTitle } from "@/components/ui/Typography";
import { requireEltOnly } from "@/lib/cash-flow-access";
import { getProjectEstimates, getCashFlowLines, resolveAsOf, listSnapshots, getLatestSnapshotSummary } from "@/lib/cash-flow";
import { CashFlowClient } from "@/components/CashFlowClient";

// Cash Flow Forecast — ELT-only (see cash-flow-access.ts's own header for
// why this is a hard role check, not a togglable Permission). "Current" is
// always live against Total ETO; any other `as`/`compare` param reads an
// immutable stored snapshot — see lib/cash-flow.ts.
export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string; compare?: string }>;
}) {
  await requireEltOnly();
  const { as, compare } = await searchParams;

  const asOf = await resolveAsOf(as);

  // `compare=none` is an explicit "don't compare"; leaving it off entirely
  // defaults to the most recent snapshot, so "Forecast Change vs Previous
  // Snapshot" (the task's own standing KPI) has a real answer on first load
  // rather than requiring the user to pick something before it means
  // anything.
  let compareAsOf = null as Awaited<ReturnType<typeof resolveAsOf>> | null;
  if (compare === "none") {
    compareAsOf = null;
  } else if (compare) {
    compareAsOf = await resolveAsOf(compare);
  } else if (asOf.kind === "current") {
    const latest = await getLatestSnapshotSummary();
    if (latest) compareAsOf = { kind: "snapshot", snapshot: latest };
  }

  const [estimates, lines, compareLines, snapshots] = await Promise.all([
    getProjectEstimates(),
    getCashFlowLines(asOf),
    compareAsOf ? getCashFlowLines(compareAsOf) : Promise.resolve(null),
    listSnapshots(),
  ]);

  return (
    <div className="w-full px-8 py-10 md:px-13 md:py-11">
      <div className="mb-1">
        <PageTitle className="mb-1">Cash Flow Forecast</PageTitle>
        <p className="max-w-3xl text-sm text-sdc-gray-600">
          Built from Total ETO&apos;s own AR sales terms, AP due dates, and open PO commitments — the same figures
          Total ETO&apos;s Project Cash Flow Forecast report is built from. Unlike that report, every refresh here
          preserves a timestamped, immutable version, so you can see what the forecast looked like at any past point
          in time. ELT only.
        </p>
      </div>

      <div className="mt-5">
        <CashFlowClient estimates={estimates} lines={lines} compareLines={compareLines} snapshots={snapshots} asOf={asOf} compareAsOf={compareAsOf} />
      </div>
    </div>
  );
}
