"use client";

import { usd } from "@/components/ui/format";
import { EChart } from "@/components/charts/EChart";
import { partsCostBarOption, PARTS_BAR } from "@/components/charts/theme";

// Parts Cost money block for the Job Hour Details page — the app's version of
// the Power BI report's Parts Cost visual: its four measures as one bar chart
// (replacing the report's gauge), plus a budget meter.
//
// These KPIs originally lived inside PartsCostSection (77c6187) and were lost
// when the two-tab Procurement drawer replaced that component wholesale
// (739e2c5 — "drops the now-unused PartsCostSection import"). Restored here as
// summary-ONLY: PartsCostSection also carried slicers and an 800-row parts
// table, and Procurement's Parts List tab is now the place for per-line detail.
//
// Labels are plain "Purchased"/"Paid" rather than the old "Purchased (filtered)"
// variants — there are no slicers here, so these are always the full totals
// across every selected job.
//
// A client component because the ECharts option carries formatter FUNCTIONS,
// which can't cross the server→client boundary as props. It therefore takes
// plain numbers rather than the whole JobPartsCost: the parts `lines` array is
// already serialized once for Procurement, and there's no reason to ship it twice.
export function PartsCostSummary({
  purchased,
  paid,
  estimated,
  budgetProjection,
  budget,
}: {
  purchased: number;
  paid: number;
  // The Cost Quoted figure from the Projects tab (Job.costQuoted), summed across
  // the selected jobs — per Dan, "Estimated" here is ALWAYS the quoted cost. It
  // was previously the parts New ETC, which read $0 for jobs with no parts ETC
  // rows (job 1142 against a $1.3M quote). Same number as `budget` below, shown
  // twice on purpose: once as a bar in the breakdown, once as the meter's target.
  // Null when no selected job has a quote on file.
  estimated: number | null;
  // "Part Cost Budget Projection": purchased + estimate-to-purchase, the latter
  // being the app's Parts New ETC (= the month's opening estimate to complete
  // less what was spent this month). Computed in lib/parts-budget-projection.ts
  // — see there for the definition and for why Power BI's estimate-to-complete
  // measure can't be the estimate half. Null when there's no ETC month; the bar
  // is then omitted rather than drawn with half the formula missing. Both halves
  // arrive so the tooltip can show the arithmetic.
  budgetProjection: { purchased: number; estimateToPurchase: number; total: number } | null;
  // "Part Cost Budget" in the report = its [Part Cost Quoted] measure,
  // SUM('Cost Estimated'[Cost Quoted]) — which is the same upstream table that
  // populates Job.costQuoted here (see syncQuotedFromPowerBi). Null when no
  // selected job has a quoted cost.
  budget: number | null;
}) {
  const leftToPay = purchased - paid;
  // Treat a ZERO quote as "nothing on file", not as a $0 target — an absent
  // estimate must not read as $0 estimated.
  const estimate = estimated != null && estimated > 0 ? estimated : null;
  // Share of budget consumed. Deliberately its own control rather than a fifth
  // bar: a $1.3M budget beside these figures still compresses them, and at other
  // ratios far worse (see partsCostBarOption). Uncapped label, capped fill, so
  // an overrun still reads as one.
  const pctOfBudget = budget != null && budget > 0 ? purchased / budget : null;

  return (
    <div className="mt-8 space-y-4">
      <p className="font-heading text-lg font-bold tracking-tight text-sdc-navy">Parts Cost</p>

      {/* The four KPI cards that used to sit to the left of this chart are gone
          by request — every figure they showed is already labelled on its own
          bar, so they were a second copy of the same four numbers. The chart now
          spans the full width, which is also what makes the bars readable at
          these magnitudes. */}
      <div className="flex flex-col rounded-xl border border-sdc-border bg-white p-4 shadow-sm">
        <p className="mb-1 text-sm font-semibold text-sdc-navy">Parts cost breakdown</p>
        <p className="mb-2 text-xs text-sdc-gray-500">Purchased, planned and invoiced dollars across the selected job(s).</p>
        <EChart
          height={190}
          option={partsCostBarOption([
            // Estimated first: it's the plan, so the bars now read plan →
            // committed → invoiced → outstanding rather than starting mid-story.
            // Axis labels stay short even at full width — "Estimated to
            // Purchase" clipped here before.
            // Colors mirror the report's colored measure names: Purchased blue,
            // Paid green, the two derived rows plain/neutral.
            {
              label: "Estimated",
              value: estimate ?? 0,
              color: PARTS_BAR.neutral,
              hint:
                estimate != null
                  ? "Cost Quoted for the selected job(s) — the same figure the Projects tab shows. The part-cost budget this job was sold against."
                  : "No Cost Quoted on file for the selected job(s).",
            },
            {
              label: "Purchased",
              value: purchased,
              color: PARTS_BAR.purchased,
              hint: "Every part committed to a purchase order, whether or not the supplier has invoiced yet.",
            },
            {
              label: "Paid",
              value: paid,
              color: PARTS_BAR.paid,
              hint: "The invoiced share of Purchased — money that has actually gone out the door.",
            },
            {
              label: "Left to pay",
              value: leftToPay,
              color: PARTS_BAR.neutral,
              hint: "Purchased − Paid: already committed on a PO, not yet invoiced.",
            },
            // Budget projection last: it's a projected TOTAL, not another
            // component of the ones above, so it reads as a summary line rather
            // than part of the running breakdown. Amber to separate it from the
            // actuals — it's the only forward-looking figure here. Omitted
            // entirely when null (see the prop docs) rather than drawn as $0.
            ...(budgetProjection != null
              ? [
                  {
                    label: "Projection",
                    value: budgetProjection.total,
                    color: PARTS_BAR.projection,
                    hint:
                      `Where part cost lands when the job finishes: Purchased ${usd(budgetProjection.purchased)} + ` +
                      `estimate to purchase ${usd(budgetProjection.estimateToPurchase)}.` +
                      (budgetProjection.estimateToPurchase === 0
                        ? " Nothing left to commit — the Parts New ETC is zero, so the projection equals Purchased."
                        : " Estimate to purchase = the Parts New ETC: this month's opening estimate to complete, less what was spent this month."),
                  },
                ]
              : []),
          ])}
        />

        {/* Budget, on its own scale — what the gauge was actually trying to
            say. mt-auto pins it to the card's bottom edge however tall the
            card gets. */}
        {pctOfBudget != null && budget != null && (
          <div className="mt-auto border-t border-sdc-border pt-3">
            <div className="flex items-baseline justify-between gap-2">
              <p
                className="cursor-help text-xs font-semibold text-sdc-gray-600"
                title={`${usd(purchased)} committed against the ${usd(budget)} Cost Quoted budget. Turns red above 100%; the fill caps at 100% but the percentage doesn't, so an overrun still reads as one.`}
              >
                Purchased vs Part Cost Budget
              </p>
              <p className="font-heading text-sm font-bold tabular-nums text-sdc-navy">
                {(pctOfBudget * 100).toFixed(1)}% of {usd(budget)}
              </p>
            </div>
            <div className="relative mt-2 h-2 w-full overflow-hidden rounded-full bg-sdc-gray-100">
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${Math.min(100, pctOfBudget * 100)}%`, background: pctOfBudget > 1 ? "#dc2626" : "#408bf7" }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
