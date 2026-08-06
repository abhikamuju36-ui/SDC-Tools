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

  // ── The single stacked bar (§61) ──────────────────────────────────────────
  //
  // ONE vertical bar whose three segments are INCREMENTS that build up
  // cumulatively — NOT the raw totals stacked on each other. The figures are
  // nested (paid ≤ purchased ≤ projection), so:
  //
  //   orange  = projection − purchased   (additional, to reach Projection)   ── top
  //   blue    = purchased  − paid        (additional, to reach Total Spent)
  //   green   = paid                     (Amount Invoiced — the base segment) ── bottom
  //
  // The three add up to the projection, so the FULL bar height represents the
  // Projection value and each segment boundary lands on a business figure:
  // top-of-green = Amount Invoiced, top-of-blue = Total Parts Cost Spent,
  // top-of-orange = Projection. The blue segment is deliberately small when
  // invoiced ≈ spent (e.g. $241) — that IS the progression the bar is meant to
  // show, per §61's own worked example. The exact cumulative dollar value of
  // each of the three figures is stated in the legend beneath the bar and in
  // each segment's tooltip, so a thin segment is never a lost number.
  //
  // Defensive Math.max keeps the increments ≥ 0 if an upstream oddity ever
  // inverts the nesting; heights are a strict share of the total, no min-height.
  const invoiced = Math.max(0, paid);
  const spentTop = Math.max(invoiced, purchased);
  const projTop = projection != null ? Math.max(spentTop, projection) : spentTop;
  const barTotal = projTop; // the full bar's value = the Projection (or Spent, if no projection)

  const segPct = (amount: number) => (barTotal > 0 ? (amount / barTotal) * 100 : 0);
  // Top-to-bottom, the order they render in the column.
  const segments = [
    projection != null && {
      key: "projection-inc",
      pct: segPct(projTop - spentTop),
      color: PARTS_BAR.projection,
      title: `Projection: ${usd(projTop)} — adds ${usd(projTop - spentTop)} still projected to buy on top of Total Parts Cost Spent`,
    },
    {
      key: "spent-inc",
      pct: segPct(spentTop - invoiced),
      color: PARTS_BAR.purchased,
      title: `Total Parts Cost Spent: ${usd(spentTop)} — adds ${usd(spentTop - invoiced)} committed but not yet invoiced on top of Amount Invoiced`,
    },
    {
      key: "invoiced-base",
      pct: segPct(invoiced),
      color: PARTS_BAR.paid,
      title: `Amount Invoiced: ${usd(invoiced)}`,
    },
  ].filter(Boolean) as { key: string; pct: number; color: string; title: string }[];

  // The legend: the three CUMULATIVE business values (each segment's top), the
  // numbers the team actually reads. Ordered to match the bar, top-to-bottom.
  const legend = [
    projection != null && { color: PARTS_BAR.projection, label: "Projection", value: projTop },
    { color: PARTS_BAR.purchased, label: "Total Parts Cost Spent", value: spentTop },
    { color: PARTS_BAR.paid, label: "Amount Invoiced", value: invoiced },
  ].filter(Boolean) as { color: string; label: string; value: number }[];

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

      {/* ── The single stacked bar (§61) ──────────────────────────────────────
          ONE vertical bar, centred in the card, three incremental segments
          building green → blue → orange so the full height is the Projection.
          `flex-1 flex-col items-center justify-center` centres the bar and its
          legend as a group; `overflow-hidden rounded-t-md` + the bottom border
          make it a bar on an axis, not a pill. The legend below states each of
          the three cumulative business values exactly, so a thin segment (the
          blue increment when invoiced ≈ spent) still has its number. */}
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-2">
        <div className="flex h-52 w-16 flex-col overflow-hidden rounded-t-md border-b border-sdc-border bg-sdc-gray-100">
          {segments.map(
            (s) =>
              s.pct > 0 && (
                <div key={s.key} className="w-full shrink-0" style={{ height: `${s.pct}%`, background: s.color }} title={s.title} />
              ),
          )}
        </div>
        <div className="flex flex-col gap-1.5 text-xs">
          {legend.map((row) => (
            <div key={row.label} className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: row.color }} />
              <span className="text-sdc-gray-600">{row.label}</span>
              <span className="ml-auto font-heading font-bold tabular-nums text-sdc-navy">{usd(row.value)}</span>
            </div>
          ))}
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
