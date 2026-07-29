"use client";

import { usd } from "@/components/ui/format";
import { IndicatorCard } from "@/components/charts/IndicatorCard";
import { EChart } from "@/components/charts/EChart";
import { partsCostBarOption, PARTS_BAR } from "@/components/charts/theme";

// Parts Cost money block for the Job Hour Details page — the app's version of
// the Power BI report's Parts Cost visual: the four-measure table, and a chart
// replacing its gauge.
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
  budget,
}: {
  purchased: number;
  paid: number;
  // Parts New ETC for the latest ETC month, summed across the selected jobs.
  // Null when there's no ETC month yet or the lookup failed — the tiles still
  // render, just without the vs-budget delta and bullet.
  estimatedToPurchase: number | null;
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
  // meaningless 0-target bullet. Only a positive estimate is a real reference.
  const estimate = estimatedToPurchase != null && estimatedToPurchase > 0 ? estimatedToPurchase : null;
  // Share of budget consumed. Deliberately its own control rather than a fifth
  // bar: a $1.3M budget beside these figures still compresses them, and at other
  // ratios far worse (see partsCostBarOption). Uncapped label, capped fill, so
  // an overrun still reads as one.
  const pctOfBudget = budget != null && budget > 0 ? purchased / budget : null;

  return (
    <div className="mt-8 space-y-4">
      <p className="font-heading text-lg font-bold tracking-tight text-sdc-navy">Parts Cost</p>

      {/* Two columns: a 2×2 block of KPI cards on the left, the chart on the
          right. items-stretch + grid-rows-2 makes the four cards divide the
          chart's height evenly, so the two halves line up top and bottom.
          Stacks to one column below lg, where side-by-side would squeeze both. */}
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        {/* KPI indicators — number + delta + bullet-vs-target (Plotly-style). */}
        <div className="grid grid-cols-2 grid-rows-2 gap-4">
          <IndicatorCard
            label="Purchased"
            value={usd(purchased)}
            numericValue={purchased}
            delta={estimate != null ? { reference: estimate, goodWhenLower: true, format: usd } : undefined}
            bullet={estimate != null ? { value: purchased, target: estimate } : undefined}
            hint={estimate != null ? "vs estimated to purchase" : undefined}
          />
          <IndicatorCard label="Estimated to Purchase" value={estimate != null ? usd(estimate) : "—"} />
          <IndicatorCard
            label="Paid"
            value={usd(paid)}
            tone="green"
            bullet={purchased > 0 ? { value: paid, target: purchased, color: "#15803d" } : undefined}
            hint={purchased > 0 ? "invoiced of purchased" : undefined}
          />
          <IndicatorCard label="Left to Pay" value={usd(leftToPay)} numericValue={leftToPay} />
        </div>

        {/* The gauge's replacement: the four measures side by side on one axis. */}
        <div className="flex flex-col rounded-xl border border-sdc-border bg-white p-4 shadow-sm">
          <p className="mb-1 text-sm font-semibold text-sdc-navy">Parts cost breakdown</p>
          <p className="mb-2 text-xs text-sdc-gray-500">Purchased, planned and invoiced dollars across the selected job(s).</p>
          <EChart
            height={190}
            option={partsCostBarOption([
              // Short axis labels: this column is half-width now, and the full
              // "Estimated to Purchase" was already clipping at full width. The
              // KPI card beside each bar carries the full name.
              // Colors mirror the report's colored measure names: Purchased
              // blue, Paid green, the two derived rows plain/neutral.
              { label: "Purchased", value: purchased, color: PARTS_BAR.purchased },
              { label: "Estimated", value: estimate ?? 0, color: PARTS_BAR.neutral },
              { label: "Paid", value: paid, color: PARTS_BAR.paid },
              { label: "Left to pay", value: leftToPay, color: PARTS_BAR.neutral },
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
    </div>
  );
}
