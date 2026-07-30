import "server-only";
import { runDax } from "@/lib/powerbi-client";
import { getExecutionEtcByJob } from "@/lib/execution-etc";
import type { PartsCostLine } from "@/lib/sync-totaleto";

// "Part Cost Budget Projection" — where a job lands by the time it's finished.
//
//   projection = purchased + estimate to purchase
//   estimate to purchase = [estimate to complete at the START of this month]
//                          − [money spent during this month]
//
// Per Dan (2026-07-29), who owns this definition. The reasoning: everything
// already on a PO is committed spend, and what's left to commit is whatever the
// month opened with minus what's since gone out.
//
// ── Estimate to purchase IS the app's Parts New ETC ───────────────────────────
// Not a coincidence — it's the same arithmetic. The PARTS_COST EtcEntry for a
// month (syncPartsCost) stores exactly Dan's two terms:
//
//   priorEtc    = the prior month's confirmed Parts New ETC
//                 → the estimate to complete AT THE START of this month
//   hoursWorked = money spent this month, straight from TotalETO
//                 (verified 2026-07-19 to match [Part Cost Purchased] to the dollar)
//
// and the effective New ETC is suggestNewEtc(priorEtc, hoursWorked) = prior −
// spent, i.e. Dan's estimate to purchase. So this reads that field rather than
// recomputing it. Two payoffs: no start-of-month snapshot has to be guessed at,
// and the projection agrees with the Parts Cost row the managers review on the
// Monthly ETC grid — a manager's confirmed override is honoured instead of
// silently contradicted.
//
// ── Why NOT Power BI's [Part Cost Estimated To Complete] ─────────────────────
// It was the estimate half here until 2026-07-30, and it inflated every
// projection. That measure is SUM('Cost Estimated'[Cost Estimated To Complete]),
// a manually-maintained figure that opens at the quote and does NOT draw down as
// parts are bought — so adding it to Purchased double-counts money already
// spent. Measured across all 44 quoted jobs with parts on 2026-07-30:
//
//   job    quoted    purchased      PBI est-to-complete    app Parts New ETC
//   1150   147,770     148,113      147,200 (~full quote)             75,251
//   1152    63,000          40       62,900 (~full quote)             62,900
//   1158   225,000      60,877      213,086 (~full quote)            213,086
//   1142 1,300,000   1,406,923                  250,000                    0
//   1130 2,114,412   1,878,665                  650,000                    0
//
// Job 1150 is the clearest tell: fully purchased against its quote, yet the
// measure still claimed the entire quote was left to complete — projecting
// $295K on a $148K job. Where nothing has been purchased yet (1152, 1158) the
// two agree exactly, which is what you'd expect if one is the other before any
// draw-down. The old comment here read the app's zeros (1142, 1130) as the app
// being wrong; they're right — those jobs are done buying, so nothing is left to
// commit and the projection should equal Purchased.
//
// Note that projection ≥ purchased ALWAYS, by construction. That's not a defect
// — parts can't be un-bought, so a finished-buying job projects at exactly what
// it purchased. The old bug was the SIZE of the gap, not its sign.
//
// Also not the report's [Budget Projection] measure, which is
//   invoiced-before-this-month + estimate-to-complete
// counting only invoiced money and dropping any PO not yet invoiced, so it can
// land BELOW what a job has already purchased — on 2026-07-29 that was true for
// 1142 (report said $547,428 against $1,406,923 purchased) and 1101. The
// report's definition, for reference (model TMDL at
// SDC-PowerBI-DEV/…/tables/Measure Tables.tmdl):
//
//   Budget Projection =
//     VAR CurrentMonth = DATE(YEAR(TODAY()), MONTH(TODAY()), 1)
//     VAR FilteredInvoiced =
//       CALCULATE([Part Invoiced Amount],
//         FILTER(ALL('Part Purchase'[Invoiced Date]),
//                'Part Purchase'[Invoiced Date] < CurrentMonth))
//     RETURN FilteredInvoiced + [Part Cost Estimated To Complete]
//
// Reconstructed and checked against the live measure across all 103 jobs that
// return a value — largest difference $0.000000 — so that shape is the measure,
// not an approximation of it. It is a defect, not a preference, which is why
// this doesn't copy it.

// Everything already committed to a PO, invoiced or not — the "Purchased"
// figure the Parts Cost tiles show.
export function purchasedTotal(lines: PartsCostLine[]): number {
  let total = 0;
  for (const l of lines) total += l.totalPrice;
  return total;
}

// Invoiced dollars strictly BEFORE the 1st of the current month — the report
// measure's FilteredInvoiced. Not part of the projection; kept because
// reconciling this page against the report needs it.
//
// `now` is injected rather than read here so the caller owns the clock (the DAX
// measure's own TODAY() resolves on the Power BI side, which is why the two can
// disagree across a month boundary).
export function invoicedBeforeCurrentMonth(lines: PartsCostLine[], now: Date): number {
  const firstOfMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  let total = 0;
  for (const l of lines) {
    if (!l.invoicedDate || !l.invoicedAmount) continue;
    const t = new Date(l.invoicedDate).getTime();
    if (Number.isNaN(t) || t >= firstOfMonth) continue;
    total += l.invoicedAmount;
  }
  return total;
}

// [Part Cost Estimated To Complete] per job id, straight from the semantic
// model. No longer feeds the projection (see the header) — kept for reconciling
// against the Power BI report, which still uses it.
export async function fetchPartsEstimatedToComplete(jobIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (jobIds.length === 0) return out;
  const list = jobIds.map((id) => `"${id.replace(/"/g, "")}"`).join(", ");
  const rows = (await runDax(`
EVALUATE
FILTER(
  SUMMARIZECOLUMNS('Job'[Job Id], "EstToComplete", [Part Cost Estimated To Complete]),
  'Job'[Job Id] IN { ${list} }
)
`)) as { "Job[Job Id]": string | null; EstToComplete: number | null }[];
  for (const r of rows) {
    const id = r["Job[Job Id]"];
    if (id != null && r.EstToComplete != null) out.set(String(id), r.EstToComplete);
  }
  return out;
}

// Returns the two halves alongside the total: the UI shows them in the bar's
// tooltip, because a projection that equals Purchased to the dollar (nothing
// left to purchase) otherwise looks like a bug.
export type PartsBudgetProjection = {
  purchased: number;
  estimateToPurchase: number;
  total: number;
};

// The projection for a set of jobs. `jobPks` are Job.id primary keys (not job
// numbers) since that's what the ETC rollup is keyed by, and `month` is the ETC
// month to read the estimate from — normally the latest one.
//
// Null when there's no ETC month at all: an absent estimate is not the same as
// an estimate of zero, and the caller hides the bar rather than drawing a
// projection with half its formula missing. A job that HAS an ETC month but no
// Parts Cost row contributes 0, which is the real answer — syncPartsCost only
// skips jobs with no opening balance and no spend.
export async function computePartsBudgetProjection(
  jobPks: number[],
  lines: PartsCostLine[],
  month: string | null,
): Promise<PartsBudgetProjection | null> {
  if (!month || jobPks.length === 0) return null;
  const etc = await getExecutionEtcByJob(jobPks, month);
  let estimateToPurchase = 0;
  for (const pk of jobPks) estimateToPurchase += etc.get(pk)?.parts ?? 0;
  // Floor at 0: a month whose spend overran what it opened estimating has
  // nothing left to commit. Negative would push the projection below money
  // already spent — the exact defect the report measure has.
  estimateToPurchase = Math.max(0, estimateToPurchase);
  const purchased = purchasedTotal(lines);
  return { purchased, estimateToPurchase, total: purchased + estimateToPurchase };
}
