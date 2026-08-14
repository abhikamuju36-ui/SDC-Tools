import "server-only";
import { prisma } from "@/lib/prisma";
import { getJobPartsCost, type PartsCostLine } from "@/lib/sync-totaleto";
import { computePartsBudgetProjection, purchasedTotal, actualTotal } from "@/lib/parts-budget-projection";
import { withTimeoutOrNull, UPSTREAM_BUDGET_MS } from "@/lib/with-timeout";
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
// Invoiced, ETC — aren't double-counting the same money.
//
// They are not. Each is already a correctly-scoped, non-overlapping slice:
//   invoiced       = actualTotal(lines)      — GL-posted spend only (lifetime)
//   leftToInvoice  = purchasedTotal(lines) − invoiced, floored at 0
//                    — committed (open PO balance + anything invoiced but not
//                      yet GL-posted); `purchased` already INCLUDES invoiced
//                      amounts by construction (PART_PURCHASE_SQL sums
//                      remaining-uninvoiced-balance + invoiced-to-date), so
//                      subtracting `invoiced` back out is what stops this
//                      double-counting it, not what causes it.
//   etc            = the job's Parts New ETC for the applicable month, itself
//                    ALREADY net of "this month's booked spend" (see
//                    parts-budget-projection.ts's own header) — floored at 0
//                    so an overspent month can't push the projection below
//                    money already committed.
// This is not a new formula: it is `computePartsBudgetProjection` (already
// correct, and already the one function every "ETC" figure on this card
// traces back to — see the audit) relabeled to the vocabulary the audit
// asked for, plus `Job.costQuoted` for Budget and the variance arithmetic,
// so every consumer reads ONE function instead of separately re-deriving
// (and risking re-deriving differently) the same numbers `job-hours/page.tsx`
// used to compute inline.
//
// What this does NOT change: the underlying formula, sources, or business
// rules (GL-posted-only Actual, lifetime Purchased, EtcEntry-sourced ETC) —
// none of that was found broken. What it fixes is that there was exactly one
// place computing it (this page's own inline IIFE) instead of a named,
// reusable function every other page could call, and a real (if usually
// sub-dollar) display artifact: three components rounded independently for
// display do not always sum to the total rounded independently — see
// `reconcilePartsCostRounding` below.

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

export async function getPartsCostFinancials(jobIds: number[], opts?: { asOfDate?: Date }): Promise<PartsCostFinancials> {
  if (jobIds.length === 0) {
    return { budget: null, invoiced: 0, leftToInvoice: 0, etc: null, totalSpent: 0, projection: 0, variance: null, variancePct: null, failedJobs: 0, lineCount: 0, lines: [] };
  }

  const jobs = await prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, jobId: true, costQuoted: true } });
  const quoted = jobs.reduce((s, j) => s + Number(j.costQuoted ?? 0), 0);
  const budget = quoted > 0 ? quoted : null;

  const perJob = await Promise.all(
    jobs.map((j) =>
      withTimeoutOrNull(`TotalETO parts (job ${j.jobId})`, UPSTREAM_BUDGET_MS, () => getJobPartsCost(j.jobId), (e) =>
        console.error(`getPartsCostFinancials: getJobPartsCost failed for job ${j.jobId}:`, e),
      ),
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
