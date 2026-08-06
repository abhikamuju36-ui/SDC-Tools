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

  // ── The Parts Cost bars (§58 rectangular bars, §60 correct scaling) ────────
  //
  // Three GROUPED bars, not a stacked one. §58 stacked the three figures as
  // segments of one bar — but they are nested (paid ≤ purchased ≤ projection),
  // so the middle segment is an INCREMENT (purchased − paid), and when invoiced
  // and spent are nearly equal that increment is a few dollars: it rendered as
  // a sliver next to a full-height green bar even though the two LABELS were
  // almost identical (§60's exact complaint — $43,502 vs $43,743 looking wildly
  // different). Stacking increments can never make two near-equal cumulative
  // values look near-equal; that is a property of the shape, not a bug to patch.
  //
  // So each value is now its own bar, drawn from a zero baseline on ONE shared
  // linear scale (the largest of the three). Two near-equal values → two
  // near-equal bar heights, strictly proportional. No min-height, no per-bar
  // normalisation, no headroom fudge — height is exactly (value / scaleMax).
  const scaleMax = Math.max(1, paid, purchased, projection ?? 0);
  // The tallest bar fills BAR_AREA px; every other bar is that fraction of it.
  const BAR_AREA = 176;
  const barPx = (v: number) => Math.max(0, (v / scaleMax) * BAR_AREA);

  const bars = [
    {
      key: "invoiced",
      label: "Amount Invoiced",
      value: paid,
      color: PARTS_BAR.paid,
      title: `Amount Invoiced: ${usd(paid)}`,
    },
    {
      key: "spent",
      label: "Total Parts Cost Spent",
      value: purchased,
      color: PARTS_BAR.purchased,
      title: `Total Parts Cost Spent: ${usd(purchased)} — committed on a PO, invoiced or not`,
    },
    ...(projection != null
      ? [
          {
            key: "projection",
            label: "Projection",
            value: projection,
            color: PARTS_BAR.projection,
            title: `Projection: ${usd(projection)} — purchased plus what is still projected to buy`,
          },
        ]
      : []),
  ];

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

      {/* ── The Parts Cost bars (§58 rectangular, §60 proportional + centred) ──
          Three real chart columns on one shared scale, sitting on a baseline.
          Each column: its exact value above, the rectangular bar, its name
          below. `rounded-t-sm` (not a pill) reads as a bar standing on the
          axis. `flex-1 justify-center items-end` CENTRES the group in the card
          both ways and hangs the bars off a common baseline (§60.3). Because
          every bar is (value / scaleMax) of the same BAR_AREA, two near-equal
          values are two near-equal bars (§60.1) — the fix for the stacked
          version making $43,502 and $43,743 look wildly different. */}
      <div className="flex flex-1 items-end justify-center gap-5 py-2">
        {bars.map((b) => (
          <div key={b.key} className="flex flex-col items-center" title={b.title}>
            <span className="mb-1 whitespace-nowrap text-micro font-bold tabular-nums text-sdc-navy">{usd(b.value)}</span>
            <div
              className="w-9 rounded-t-sm"
              style={{ height: `${barPx(b.value)}px`, background: b.color }}
            />
            <span className="mt-1.5 w-16 text-center text-label leading-tight text-sdc-gray-600">{b.label}</span>
          </div>
        ))}
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
