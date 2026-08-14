import type { PartsCostLine } from "@/lib/sync-totaleto";

// Split out of parts-cost-financials.ts (2026-08-15): that file starts with
// `import "server-only"`, so a CLIENT component importing anything more than
// a bare type from it — as PartsCostSummary.tsx needs to for
// `reconcilePartsCostRounding`, a plain runtime function with no server
// dependency at all — pulls the whole module (Prisma, the live TotalETO
// query) into the client bundle and trips Next's server-only guard. This
// file holds exactly the two things safe for either side to import: the
// shape of the reconciliation, and the pure rounding fix. The async
// `getPartsCostFinancials` that actually PRODUCES a `PartsCostFinancials`
// stays server-only, in parts-cost-financials.ts.

export type PartsCostFinancials = {
  /** Job.costQuoted, summed across the requested jobs. Null when none has a quote on file. */
  budget: number | null;
  /** GL-posted spend, lifetime, full precision. THE app-wide definition of Parts Actual. */
  invoiced: number;
  /** Committed but not GL-posted (open PO balance + non-GL-posted invoices), full precision, floored at 0. */
  leftToInvoice: number;
  /**
   * This job's Parts New ETC for the applicable month (see `asOfDate`), already net of
   * this month's booked spend and floored at 0. Null — not 0 — when there is no ETC
   * month at all for these jobs: an absent estimate is not the same as an estimate of
   * zero (mirrors computePartsBudgetProjection's own null case).
   */
  etc: number | null;
  /** invoiced + leftToInvoice — "how much has actually been committed to date" (= Purchased). */
  totalSpent: number;
  /** invoiced + leftToInvoice + (etc ?? 0) — where this job is projected to land. */
  projection: number;
  /** projection − budget. Null when budget is null. */
  variance: number | null;
  /** variance / budget × 100. Null when budget is null or zero. */
  variancePct: number | null;
  /** How many of the requested jobs' live TotalETO reads failed or timed out. */
  failedJobs: number;
  /** Total PartsCostLine rows aggregated (0 when every job failed). */
  lineCount: number;
  /**
   * The raw per-line rows this was aggregated from — exposed so a caller that
   * also needs line-level detail (e.g. JobProcurement's parts list) can reuse
   * this same TotalETO fetch instead of issuing a second one for the same jobs.
   */
  lines: PartsCostLine[];
};

// ── Rounding that can't visibly contradict itself ────────────────────────────
//
// Audit finding: rounding Invoiced/Left to Invoice/ETC to whole dollars
// INDEPENDENTLY, then summing those three rounded numbers, does not always
// equal the (separately, correctly) rounded Projection total — a classic
// "sum of roundings ≠ rounding of the sum" artifact, not a calculation error.
// Measured on the job that prompted this audit: 23207.616 + 101371.554 +
// 189298.04 = 313877.21 exactly (full precision reconciles to the cent) —
// but round(23207.616)=23208, round(101371.554)=101372, round(189298.04)=
// 189298, and 23208+101372+189298 = 313878, one dollar more than
// round(313877.21) = 313877. Both individual roundings are each correct in
// isolation; a user manually re-adding the DISPLAYED numbers gets a
// different total than the one displayed, which reads as the app being
// wrong even though nothing in the underlying math is.
//
// Fixed with the standard "largest remainder" allocation: floor every part,
// then hand the leftover whole dollars (the difference between the floors'
// sum and the correctly-rounded total) to whichever parts lost the most to
// flooring. The result always sums to exactly Math.round(total), and no
// individual figure is ever off by more than the same ~$1 plain rounding
// already risked — this only decides WHICH parts absorb it, so the visible
// pieces always add up to the visible total.
export function reconcilePartsCostRounding(parts: number[]): number[] {
  const total = Math.round(parts.reduce((s, p) => s + p, 0));
  const floors = parts.map((p) => Math.floor(p));
  const floorSum = floors.reduce((s, f) => s + f, 0);
  const remainders = parts.map((p, i) => p - floors[i]);
  const order = remainders.map((_, i) => i).sort((a, b) => remainders[b] - remainders[a]);
  const toDistribute = Math.max(0, Math.min(parts.length, total - floorSum));
  const result = [...floors];
  for (let k = 0; k < toDistribute; k++) result[order[k]] += 1;
  return result;
}
