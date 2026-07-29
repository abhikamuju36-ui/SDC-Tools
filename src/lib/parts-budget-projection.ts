import "server-only";
import { runDax } from "@/lib/powerbi-client";
import type { PartsCostLine } from "@/lib/sync-totaleto";

// "Part Cost Budget Projection" — a faithful port of the Power BI report's
// [Budget Projection] measure, whose definition (from the model's TMDL at
// SDC-PowerBI-DEV/…/tables/Measure Tables.tmdl) is:
//
//   Budget Projection =
//     VAR CurrentMonth = DATE(YEAR(TODAY()), MONTH(TODAY()), 1)
//     VAR FilteredInvoiced =
//       CALCULATE([Part Invoiced Amount],
//         FILTER(ALL('Part Purchase'[Invoiced Date]),
//                'Part Purchase'[Invoiced Date] < CurrentMonth))
//     RETURN FilteredInvoiced + [Part Cost Estimated To Complete]
//
// i.e. money invoiced BEFORE the 1st of the current month, plus the parts still
// estimated to complete: sunk cost + remaining plan.
//
// Reconstructed and checked against the live measure across all 103 jobs that
// return a value — largest difference $0.000000 — so the shape below is the
// measure, not an approximation of it.
//
// ── Why the estimate comes from Power BI and not from ETC ────────────────────
// [Part Cost Estimated To Complete] is SUM('Cost Estimated'[Cost Estimated To
// Complete]) — the same upstream table that feeds Job.costQuoted here (see
// syncQuotedFromPowerBi). It is NOT the app's own parts New ETC. Measured
// 2026-07-29 for the 2026-07 month:
//
//   job    app parts New ETC    PBI Cost Estimated To Complete
//   1130                    0                         650,000
//   1142                    0                         250,000
//   1143               37,886                         370,000
//   1157              753,651                         830,000
//
// Substituting the ETC figure would have produced a confidently wrong
// projection (zero for two of those jobs), so this reads the real measure.
//
// The invoiced half, by contrast, is computed from the app's OWN parts lines:
// they're live from TotalETO, where the model's copy is only as fresh as its
// last dataset refresh (~daily). That means the number here can legitimately
// differ from the report's while the formula is identical — the app is using
// fresher inputs, not different arithmetic.

// Sum of invoiced dollars dated strictly before the 1st of the current month —
// the measure's FilteredInvoiced, over lines the caller already has.
//
// `now` is injected rather than read here so the caller owns the clock (this is
// called from a server component; the DAX measure's own TODAY() resolves on the
// Power BI side, which is why the two can disagree across a month boundary).
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
// model. One query for every requested job. Returns an empty map on any
// failure — callers treat that as "no projection available" and hide the bar
// rather than showing a projection that's missing half its formula.
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

// The projection for a set of jobs: invoiced-before-this-month (from live parts
// lines) + estimated-to-complete (from the model). Null when the estimate can't
// be read at all, since half the formula would be missing.
export async function computePartsBudgetProjection(
  jobIds: string[],
  lines: PartsCostLine[],
  now: Date,
): Promise<number | null> {
  const estimates = await fetchPartsEstimatedToComplete(jobIds);
  if (estimates.size === 0) return null;
  let estimateTotal = 0;
  for (const id of jobIds) estimateTotal += estimates.get(id) ?? 0;
  return invoicedBeforeCurrentMonth(lines, now) + estimateTotal;
}
