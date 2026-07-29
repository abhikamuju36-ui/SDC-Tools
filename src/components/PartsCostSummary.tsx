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
  estimatedToPurchase,
  budgetProjection,
  budget,
}: {
  purchased: number;
  paid: number;
  // Parts New ETC for the latest ETC month, summed across the selected jobs.
  // Null when there's no ETC month yet or the lookup failed — the chart still
  // renders, with the Estimated bar at zero.
  estimatedToPurchase: number | null;
  // The report's [Budget Projection]: invoiced before the 1st of this month +
  // [Part Cost Estimated To Complete]. Computed in lib/parts-budget-projection.ts
  // — see there for the verified definition and why the estimate half has to
  // come from the semantic model rather than from the app's parts New ETC.
  // Null when the estimate couldn't be read; the bar is then omitted rather than
  // drawn with half the formula missing.
  budgetProjection: number | null;
  // "Part Cost Budget" in the report = its [Part Cost Quoted] measure,
  // SUM('Cost Estimated'[Cost Quoted]) — which is the same upstream table that
  // populates Job.costQuoted here (see syncQuotedFromPowerBi). Null when no
  // selected job has a quoted cost.
  budget: number | null;
}) {
  const leftToPay = purchased - paid;
  // Treat a ZERO estimate as "no estimate on file", not as a $0 target. Seen
  // live: a job with no parts ETC rows summed to 0, and comparing against it
  // produced a red "▲ $1,406,923 vs estimated to purchase" delta plus a
  // meaningless 0-target bullet. Kept now that those tiles are gone because the
  // distinction still matters — an absent estimate must not read as $0 spent.
  const estimate = estimatedToPurchase != null && estimatedToPurchase > 0 ? estimatedToPurchase : null;
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
            { label: "Estimated", value: estimate ?? 0, color: PARTS_BAR.neutral },
            { label: "Purchased", value: purchased, color: PARTS_BAR.purchased },
            { label: "Paid", value: paid, color: PARTS_BAR.paid },
            { label: "Left to pay", value: leftToPay, color: PARTS_BAR.neutral },
            // Budget projection last: it's a projected TOTAL, not another
            // component of the ones above, so it reads as a summary line rather
            // than part of the running breakdown. Amber to separate it from the
            // actuals — it's the only forward-looking figure here. Omitted
            // entirely when null (see the prop docs) rather than drawn as $0.
            ...(budgetProjection != null
              ? [{ label: "Projection", value: budgetProjection, color: PARTS_BAR.projection }]
              : []),
          ])}
        />

        {/* Budget, on its own scale — what the gauge was actually trying to
            say. mt-auto pins it to the card's bottom edge however tall the
            card gets. */}
        {pctOfBudget != null && budget != null && (
          <div className="mt-auto border-t border-sdc-border pt-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold text-sdc-gray-600">Purchased vs Part Cost Budget</p>
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
