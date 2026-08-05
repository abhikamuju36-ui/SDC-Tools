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
  jobCount = 1,
  failedJobs = 0,
}: {
  purchased: number;
  paid: number;
  // How many jobs these totals cover. The money figures aggregate correctly
  // across a multi-job selection (unlike the BOM below them), so the card
  // follows the slicer — it just has to say how many jobs it's adding up.
  jobCount?: number;
  // Jobs whose TotalETO parts pull failed. Their lines are missing from the
  // totals, so the card says so instead of presenting a short figure as if it
  // were the whole picture — a silently-dropped job reads as "nothing bought".
  failedJobs?: number;
  // The Parts Cost Quoted figure from the Projects tab (Job.costQuoted), summed across
  // the selected jobs — per Dan, "Estimated" here is ALWAYS the quoted cost. It
  // was previously the parts New ETC, which read $0 for jobs with no parts ETC
  // rows (job 1142 against a $1.3M quote).
  //
  // Serves double duty: the Estimated bar, and the variance meter's baseline.
  // There used to be a separate `budget` prop for the meter, fed the same
  // Job.costQuoted from the same page — two names for one number, which is how
  // the card ended up printing "87.2% of $636,234" twice.
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
}) {
  const leftToPay = purchased - paid;
  // Treat a ZERO quote as "nothing on file", not as a $0 target — an absent
  // estimate must not read as $0 estimated.
  const estimate = estimated != null && estimated > 0 ? estimated : null;

  // ONE meter: where the job is HEADING against what it was sold for.
  //
  // Was two (purchased-vs-budget and projected-vs-budget), which showed the same
  // "87.2% of $636,234" twice on a job that has finished buying — two controls
  // saying one thing. Purchased is already a bar above, so the only figure that
  // needed its own control is the forward-looking one.
  //
  // Stated as a signed VARIANCE rather than a share: "12.8% under" is the
  // sentence someone actually needs, where "87.2% of budget" makes the reader do
  // the subtraction. Sign convention matches the Projects grid — under budget is
  // green, over is red.
  // Nothing bought and nothing projected. The variance maths is technically
  // right — $0 against an $8,600 quote IS 100% under — but "100.0% under" in
  // green announces a triumph on a job where the buying simply hasn't started,
  // and that's the reading someone acts on. An absence of data isn't a saving.
  const noPartsActivity = purchased === 0 && (budgetProjection?.total ?? 0) === 0;

  const variance =
    estimate != null && budgetProjection != null && !noPartsActivity
      ? {
          projection: budgetProjection.total,
          estimate,
          dollars: budgetProjection.total - estimate, // + = over
          pct: (budgetProjection.total - estimate) / estimate,
          // Fill is the share consumed, capped; the label stays uncapped so an
          // overrun still reads as one.
          fill: Math.min(100, (budgetProjection.total / estimate) * 100),
        }
      : null;

  return (
    // Tightened by request (Dan, 2026-07-30): this block was taking most of a
    // screen on its way to Procurement, which is where the actual part detail
    // lives. mt-6 not mt-8, one header line instead of a title plus a heading
    // plus a subtitle, a 150px chart instead of 190, and the two meters share a
    // row. Nothing was removed — it's the same five bars and the same figures.
    <div className="mt-6 space-y-3">
      {/* The four KPI cards that used to sit to the left of this chart are gone
          by request — every figure they showed is already labelled on its own
          bar, so they were a second copy of the same four numbers. The chart now
          spans the full width, which is also what makes the bars readable at
          these magnitudes. */}
      <div className="flex flex-col rounded-xl border border-sdc-border bg-white p-4 shadow-sm">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="font-heading text-lg font-bold tracking-tight text-sdc-navy">Parts Cost</p>
          <p className="text-xs text-sdc-gray-500">
            Purchased, planned and invoiced dollars
            {jobCount > 1 ? ` summed across all ${jobCount} selected jobs.` : " for the selected job."}
          </p>
        </div>
        {failedJobs > 0 && (
          <p className="mb-2 rounded border border-sdc-yellow bg-sdc-yellow-bg px-2 py-1 text-note text-sdc-yellow-text">
            {failedJobs} of {jobCount} jobs couldn&apos;t be reached in Total ETO, so their parts are missing from these totals. The
            figures below are a floor, not the full picture.
          </p>
        )}
        <EChart
          height={150}
          option={partsCostBarOption([
            // Estimated first: it's the plan, so the bars now read plan →
            // committed → invoiced → outstanding rather than starting mid-story.
            // Axis labels stay short even at full width — "Estimated to
            // Purchase" clipped here before.
            // Colors mirror the report's colored measure names: Purchased blue,
            // Paid green, the two derived rows plain/neutral.
            // What each bar means (Estimated = Parts Cost Quoted, Purchased = on a PO
            // whether invoiced or not, Paid = the invoiced share, Left to pay =
            // Purchased − Paid) used to be hover text on the bars. Removed by
            // request — the panel covered the card. Kept as documentation here.
            { label: "Estimated", value: estimate ?? 0, color: PARTS_BAR.neutral },
            { label: "Purchased", value: purchased, color: PARTS_BAR.purchased },
            { label: "Paid", value: paid, color: PARTS_BAR.paid },
            { label: "Left to pay", value: leftToPay, color: PARTS_BAR.neutral },
            // Budget projection last: it's a projected TOTAL, not another
            // component of the ones above, so it reads as a summary line rather
            // than part of the running breakdown. Amber to separate it from the
            // actuals — it's the only forward-looking figure here. Omitted
            // entirely when null (see the prop docs) rather than drawn as $0.
            // Projection = Purchased + estimate to purchase (the Parts New ETC:
            // this month's opening estimate to complete, less what was spent this
            // month). It equals Purchased exactly when that ETC is zero — nothing
            // left to commit. The Projected meter below carries this in its own
            // tooltip, which is where the explanation lives now.
            ...(budgetProjection != null
              ? [{ label: "Projection", value: budgetProjection.total, color: PARTS_BAR.projection }]
              : []),
          ])}
        />

        {/* Projection vs Estimated — the one figure that says whether this job
            lands over what it was sold for, while there's still time to act.
            mt-auto pins it to the card's bottom edge. */}
        {/* No activity yet: say that, rather than dressing a standing start up
            as a 100% saving. Only shown when there IS a quote to be measured
            against — with no estimate on file there's nothing to report. */}
        {variance == null && noPartsActivity && estimate != null && (
          <div className="mt-auto border-t border-sdc-border pt-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold text-sdc-gray-600">Projection vs Estimated</p>
              <p className="font-heading text-sm font-bold text-sdc-gray-500">
                No parts activity yet · {usd(estimate)} estimated
              </p>
            </div>
          </div>
        )}

        {variance != null && (
          <div className="mt-auto border-t border-sdc-border pt-3">
            <div className="flex items-baseline justify-between gap-2">
              <p
                className="cursor-help text-xs font-semibold text-sdc-gray-600"
                title={
                  `Projected part cost ${usd(variance.projection)} against the ${usd(variance.estimate)} Parts Cost Quoted estimate — ` +
                  `${usd(Math.abs(variance.dollars))} ${variance.dollars > 0 ? "over" : "under"}. ` +
                  "Projection = Purchased + estimate to purchase (the Parts New ETC), so this moves as parts are bought and the ETC is revised."
                }
              >
                Projection vs Estimated
              </p>
              <p className="font-heading text-sm font-bold tabular-nums">
                {/* Zero handled separately: "0.0% over" reads as a rounding
                    artefact where "on estimate" is unambiguous. */}
                {Math.abs(variance.pct) < 0.0005 ? (
                  <span className="text-sdc-gray-500">On estimate · {usd(variance.estimate)}</span>
                ) : (
                  <>
                    <span className={variance.dollars > 0 ? "text-sdc-red-text" : "text-sdc-green-text"}>
                      {Math.abs(variance.pct * 100).toFixed(1)}% {variance.dollars > 0 ? "over" : "under"}
                    </span>
                    {/* The dollar figure alongside the percentage: 13% of a $30K
                        job and 13% of a $1.4M job are very different problems. */}
                    <span className="text-sdc-gray-500">
                      {" "}
                      ({variance.dollars > 0 ? "+" : "−"}
                      {usd(Math.abs(variance.dollars))})
                    </span>
                  </>
                )}
              </p>
            </div>
            <div className="relative mt-2 h-2 w-full overflow-hidden rounded-full bg-sdc-gray-100">
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${variance.fill}%`, background: variance.dollars > 0 ? "#dc2626" : "#408bf7" }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
