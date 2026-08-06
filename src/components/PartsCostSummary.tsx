"use client";

import { usd } from "@/components/ui/format";
import { card } from "@/components/ui/classnames";
import { PARTS_BAR } from "@/components/charts/theme";

// Parts Cost money block for the Job Hour Details page — the app's version of
// the Power BI report's Parts Cost visual: one compact vertical "bullet" bar
// (§52, turned vertical for §54) comparing Amount Invoiced, Total Parts Cost
// Spent and Projection on one shared scale, plus a budget meter.
//
// These KPIs originally lived inside PartsCostSection (77c6187) and were lost
// when the two-tab Procurement drawer replaced that component wholesale
// (739e2c5 — "drops the now-unused PartsCostSection import"). Restored here as
// summary-ONLY: PartsCostSection also carried slicers and an 800-row parts
// table, and Procurement's Parts List tab is now the place for per-line detail.
//
// A client component so it composes as a grid item beside the two hours charts
// in JobHoursDashboard (§52) — it takes plain numbers rather than the whole
// JobPartsCost, since the parts `lines` array is already serialized once for
// Procurement and there's no reason to ship it twice.
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
  // Feeds only the variance meter's baseline now — the bullet bar above it (§52)
  // shows Invoiced/Spent/Projection, not Estimated, so this is no longer double
  // duty. Null when no selected job has a quote on file.
  estimated: number | null;
  // "Part Cost Budget Projection": purchased + estimate-to-purchase, the latter
  // being the app's Parts New ETC (= the month's opening estimate to complete
  // less what was spent this month). Computed in lib/parts-budget-projection.ts
  // — see there for the definition and for why Power BI's estimate-to-complete
  // measure can't be the estimate half. Null when there's no ETC month; the
  // Projection marker is then omitted rather than drawn with half the formula
  // missing.
  budgetProjection: { purchased: number; estimateToPurchase: number; total: number } | null;
}) {
  // Treat a ZERO quote as "nothing on file", not as a $0 target — an absent
  // estimate must not read as $0 estimated.
  const estimate = estimated != null && estimated > 0 ? estimated : null;
  const projection = budgetProjection?.total ?? null;

  // One shared scale for the bullet bar, with headroom so the largest marker's
  // dashed line never sits flush against the track's top edge — the same
  // clipping trap §33/§38 kept finding elsewhere in this app. `projection ≥
  // purchased` always (see parts-budget-projection.ts), so in the normal case
  // this is Projection's own value driving the scale; the max() still covers
  // the (rare) case where nothing has been spent but something was invoiced.
  const scaleMax = Math.max(1, paid, purchased, projection ?? 0) * 1.08;
  const pct = (v: number) => Math.min(100, Math.max(0, (v / scaleMax) * 100));

  // ONE meter: where the job is HEADING against what it was sold for.
  //
  // Was two (purchased-vs-budget and projected-vs-budget), which showed the same
  // "87.2% of $636,234" twice on a job that has finished buying — two controls
  // saying one thing. Purchased is already on the bullet bar above, so the only
  // figure that needed its own control is the forward-looking one.
  //
  // Stated as a signed VARIANCE rather than a share: "12.8% under" is the
  // sentence someone actually needs, where "87.2% of budget" makes the reader do
  // the subtraction. Sign convention matches the Projects grid — under budget is
  // green, over is red.
  // Nothing bought and nothing projected. The variance maths is technically
  // right — $0 against an $8,600 quote IS 100% under — but "100.0% under" in
  // green announces a triumph on a job where the buying simply hasn't started,
  // and that's the reading someone acts on. An absence of data isn't a saving.
  const noPartsActivity = purchased === 0 && (projection ?? 0) === 0;

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
    // The four KPI cards that used to sit beside this chart are gone by
    // request — every figure they showed is already labelled on the bar below,
    // so they were a second copy of the same numbers.
    <div className={`${card("p-4")} flex h-full flex-col`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="font-heading text-base font-bold tracking-tight text-sdc-navy">Parts Cost</p>
        <p className="text-note text-sdc-gray-400">
          {jobCount > 1 ? `Summed across all ${jobCount} selected jobs` : "For the selected job"}
        </p>
      </div>
      {failedJobs > 0 && (
        <p className="mb-2 rounded border border-sdc-yellow bg-sdc-yellow-bg px-2 py-1 text-note text-sdc-yellow-text">
          {failedJobs} of {jobCount} jobs couldn&apos;t be reached in Total ETO, so their parts are missing from these totals. The
          figures below are a floor, not the full picture.
        </p>
      )}

      {/* ── The bullet bar (§52.3), vertical (§54.1) ─────────────────────────
          One shared scale, three figures: a filled bar for Amount Invoiced (the
          money actually paid out so far, growing up from the baseline) and two
          dashed horizontal markers — Total Parts Cost Spent (committed on a PO,
          invoiced or not) and Projection (purchased + what's left to buy) —
          crossing the same bar at their own heights. Exact values are stated in
          the legend row beside it, so the bar itself only has to carry the
          comparison, not the reading.
          `flex-1` on the row below lets the fixed-height bar centre inside
          whatever room the row ends up with once the grid stretches this card
          to match its two siblings (§54.3) — it never looks stranded at the
          top or bottom of a taller card. */}
      <div className="mb-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: PARTS_BAR.paid }} />
          <span className="text-sdc-gray-600">Amount Invoiced</span>
          <span className="font-heading font-bold tabular-nums text-sdc-navy">{usd(paid)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-2.5 border-t-2 border-dashed" style={{ borderColor: PARTS_BAR.purchased }} />
          <span className="text-sdc-gray-600">Total Parts Cost Spent</span>
          <span className="font-heading font-bold tabular-nums text-sdc-navy">{usd(purchased)}</span>
        </span>
        {projection != null && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-2.5 border-t-2 border-dashed" style={{ borderColor: PARTS_BAR.projection }} />
            <span className="text-sdc-gray-600">Projection</span>
            <span className="font-heading font-bold tabular-nums text-sdc-navy">{usd(projection)}</span>
          </span>
        )}
      </div>
      <div className="flex flex-1 items-center justify-center py-2">
        <div
          className="relative flex h-56 w-10 flex-col justify-end rounded-full bg-sdc-gray-100"
          title={`Amount Invoiced: ${usd(paid)}`}
        >
          <div
            className="w-full rounded-full"
            style={{ height: `${pct(paid)}%`, background: PARTS_BAR.paid }}
          />
          <div
            className="absolute -left-1.5 -right-1.5 border-t-2 border-dashed"
            style={{ bottom: `${pct(purchased)}%`, borderColor: PARTS_BAR.purchased }}
            title={`Total Parts Cost Spent: ${usd(purchased)}`}
          />
          {projection != null && (
            <div
              className="absolute -left-1.5 -right-1.5 border-t-2 border-dashed"
              style={{ bottom: `${pct(projection)}%`, borderColor: PARTS_BAR.projection }}
              title={`Projection: ${usd(projection)}`}
            />
          )}
        </div>
      </div>

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
            <p className="font-heading text-sm font-bold text-sdc-muted">
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
                <span className="text-sdc-muted">On estimate · {usd(variance.estimate)}</span>
              ) : (
                <>
                  <span className={variance.dollars > 0 ? "text-sdc-red-text" : "text-sdc-green-text"}>
                    {Math.abs(variance.pct * 100).toFixed(1)}% {variance.dollars > 0 ? "over" : "under"}
                  </span>
                  {/* The dollar figure alongside the percentage: 13% of a $30K
                      job and 13% of a $1.4M job are very different problems. */}
                  <span className="text-sdc-muted">
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
  );
}
