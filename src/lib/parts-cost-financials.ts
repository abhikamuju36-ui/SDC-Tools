import "server-only";
import { prisma } from "@/lib/prisma";
import { getJobPartsCost, type PartsCostLine } from "@/lib/sync-totaleto";
import { computePartsBudgetProjection, purchasedTotal, actualTotal } from "@/lib/parts-budget-projection";
import { withTimeoutOrNull, UPSTREAM_BUDGET_MS } from "@/lib/with-timeout";
import { mapWithConcurrency } from "@/lib/map-concurrent";
// The type and the pure rounding helper live in a sibling module with no
// "server-only"/Prisma/TotalETO dependency (see its own header) so a CLIENT
// component (PartsCostSummary.tsx) can import `reconcilePartsCostRounding`
// without pulling this whole server-only file into its bundle. Re-exported
// here too so existing server-side imports of `PartsCostFinancials` from
// THIS module keep working unchanged.
export type { PartsCostFinancials } from "@/lib/parts-cost-financials-shared";
import type { PartsCostFinancials } from "@/lib/parts-cost-financials-shared";

// ── THE one Parts Cost reconciliation, for any job or set of jobs ───────────
//
// Audited 2026-08-15 (report: "Audit Parts Cost Projection Formula Across All
// Projects") after several projects showed a large "over budget" projection
// and the request was to confirm the three components — Invoiced, Left to be
// Invoiced, ETC — aren't double-counting the same money. That audit concluded
// they weren't, on the grounds that each is a distinctly-defined, non-
// overlapping slice — true of their DEFINITIONS, but it didn't check whether
// summing all three double-counts the same dollar across TIME, which it does.
// Corrected 2026-08-17 after a real project's figures were reviewed and found
// to double-count exactly this way (see parts-budget-projection.ts's header
// for the full mechanism):
//
//   invoiced       = actualTotal(lines)      — GL-posted spend only (lifetime)
//   leftToInvoice  = purchasedTotal(lines) − invoiced, floored at 0
//                    — committed (open PO balance + anything invoiced but not
//                      yet GL-posted). Displayed, and included in
//                      `totalSpent`, but NOT in `projection` — see below.
//   etc            = the job's Parts New ETC for the applicable month —
//                    floored at 0 so an overspent month can't push the
//                    projection below money already spent. This is drawn down
//                    by GL-posted spend only (the same basis as `invoiced`),
//                    NEVER by an open PO's balance — so it still contains
//                    whatever `leftToInvoice` represents until that PO is
//                    actually invoiced. Summing `invoiced + leftToInvoice +
//                    etc` counted that money twice; `invoiced + etc` does not,
//                    because a manager's ETC is meant to already answer "what
//                    will it cost to finish this job", which necessarily
//                    accounts for whatever's already on order.
//
//   Total Parts Cost Spent = invoiced + leftToInvoice   (unchanged — this is
//                                                         real money moved or
//                                                         committed to date)
//   Projection             = invoiced + max(leftToInvoice, etc ?? 0)
//                                                        (2026-08-17, floored 2026-08-19)
//
// `leftToInvoice` stays a real, displayed figure — "how much of ETC is
// already spoken for by an open PO" is worth knowing — it is just never
// SUMMED alongside `etc` into `projection` (that would double-count, the
// 2026-08-17 fix). As of 2026-08-19 it also acts as a floor: reported live on
// job 1119 (Karl Storz), Projection ($127,219 = invoiced + etc) read BELOW
// Total Parts Cost Spent ($133,428 = invoiced + leftToInvoice) because that
// job's ETC hadn't caught up to its own open PO balance — a projected FINAL
// cost below money already spent/committed, which the business requires
// never happen. `computePartsBudgetProjection`'s `projectionResidual` now
// takes whichever of leftToInvoice/etc is larger, so Projection can never
// fall below Total Parts Cost Spent again, while staying byte-identical to
// the 2026-08-17 formula whenever ETC is current (the common case).
//
// This reads `computePartsBudgetProjection` — the one function every "ETC"
// figure on this card traces back to — relabeled to the vocabulary the audit
// asked for, plus `Job.costQuoted` for Budget and the variance arithmetic, so
// every consumer reads ONE function instead of separately re-deriving (and
// risking re-deriving differently) the same numbers `job-hours/page.tsx` used
// to compute inline.
//
// A real (if usually sub-dollar) display artifact also lives here: components
// rounded independently for display do not always sum to a total rounded
// independently — see `reconcilePartsCostRounding` below.

function monthKeyOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Resolves which ETC month to read the Parts New ETC from. Defaults to the
// latest month these jobs have ANY EtcEntry for (locked or not) — the same
// rule job-hours-dashboard.ts's own `latestEtcMonth` already uses, so calling
// this with no `asOfDate` reproduces today's behavior exactly. `asOfDate`
// narrows to the latest month AT OR BEFORE it — a best-effort "as of a past
// date" reading of the ETC carry-forward chain, not a full historical
// reconstruction of Purchased/Actual (those come from a live TotalETO query,
// which has no "as of" mode to time-travel).
async function resolveEtcMonth(jobIds: number[], asOfDate: Date | undefined): Promise<string | null> {
  if (jobIds.length === 0) return null;
  const where = asOfDate ? { jobId: { in: jobIds }, month: { lte: monthKeyOf(asOfDate) } } : { jobId: { in: jobIds } };
  const latest = await prisma.etcEntry.findFirst({ where, orderBy: { month: "desc" }, select: { month: true } });
  return latest?.month ?? null;
}

/** How many per-job Total ETO parts calls may be in flight at once. See the note at the call site. */
const PARTS_FETCH_CONCURRENCY = 6;

export async function getPartsCostFinancials(jobIds: number[], opts?: { asOfDate?: Date }): Promise<PartsCostFinancials> {
  if (jobIds.length === 0) {
    return { budget: null, invoiced: 0, leftToInvoice: 0, etc: null, totalSpent: 0, projection: 0, variance: null, variancePct: null, failedJobs: 0, lineCount: 0, lines: [] };
  }

  const jobs = await prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, jobId: true, costQuoted: true } });
  const quoted = jobs.reduce((s, j) => s + Number(j.costQuoted ?? 0), 0);
  const budget = quoted > 0 ? quoted : null;

  // Bounded rather than Promise.all (2026-08-24). This is one live Total ETO
  // call PER JOB, so an unbounded map meant a 59-job selection became 59
  // simultaneous upstream requests — which is exactly why the caller used to cap
  // parts at 12 jobs and show $0 above that. Capping the fan-out here is what
  // makes lifting that cap defensible: a whole-Active-group selection now
  // resolves in waves instead of a thundering herd.
  //
  // 6 is a deliberate compromise, not a tuned figure: high enough that 59 jobs
  // is ~10 waves rather than 59 sequential round trips, low enough to stay well
  // inside what Total ETO handles comfortably. Each call keeps its own
  // UPSTREAM_BUDGET_MS timeout, so one wedged job delays a slot, never the
  // whole aggregate.
  const perJob = await mapWithConcurrency(jobs, PARTS_FETCH_CONCURRENCY, (j) =>
    withTimeoutOrNull(`TotalETO parts (job ${j.jobId})`, UPSTREAM_BUDGET_MS, () => getJobPartsCost(j.jobId), (e) =>
      console.error(`getPartsCostFinancials: getJobPartsCost failed for job ${j.jobId}:`, e),
    ),
  );
  const failedJobs = perJob.filter((v) => v == null).length;
  const lines: PartsCostLine[] = perJob.flatMap((v) => v?.lines ?? []);

  const etcMonth = await resolveEtcMonth(jobs.map((j) => j.id), opts?.asOfDate);
  const projection = await computePartsBudgetProjection(jobs.map((j) => j.id), lines, etcMonth).catch(() => null);

  const invoiced = actualTotal(lines);
  const leftToInvoice = projection ? projection.committedNotPosted : Math.max(0, purchasedTotal(lines) - invoiced);
  const etc = projection ? projection.estimateToPurchase : null;
  const totalSpent = invoiced + leftToInvoice;
  const projectionTotal = projection ? projection.total : totalSpent;

  const variance = budget != null ? projectionTotal - budget : null;
  const variancePct = budget != null && budget !== 0 ? (variance! / budget) * 100 : null;

  return {
    budget,
    invoiced,
    leftToInvoice,
    etc,
    totalSpent,
    projection: projectionTotal,
    variance,
    variancePct,
    failedJobs,
    lineCount: lines.length,
    lines,
  };
}
