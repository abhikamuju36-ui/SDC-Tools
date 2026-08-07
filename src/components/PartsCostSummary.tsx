"use client";

import { usd } from "@/components/ui/format";
import { card } from "@/components/ui/classnames";
import { useChartTooltip, type TooltipData } from "@/components/charts/ChartTooltip";

const OVER = "#dc2626"; // red — over estimate
const UNDER = "#15803d"; // green — under estimate

// Sequential ramp for the three "money that has already moved" rows — Budget
// (the plan, most certain, darkest), Amount Invoiced, Total Parts Cost Spent
// (lightest of the three, the least final) — reusing the app's own navy→blue
// steps rather than inventing a new ramp, same idea as a single-hue magnitude
// ramp elsewhere in the app. Projection carries a STATUS color instead (OVER/
// UNDER above), since it is the one forward-looking, over-or-under figure.
const BAR_BUDGET = "var(--sdc-navy)";
const BAR_INVOICED = "var(--sdc-blue-dark)";
const BAR_SPENT = "var(--sdc-blue)";

type PartsBarRow = {
  key: "budget" | "invoiced" | "spent" | "projection";
  label: string;
  value: number;
  color: string;
  emphasize?: boolean;
};

// Parts Cost money block for the Job Hour Details page — the app's version of
// the Power BI report's Parts Cost visual: four horizontal bullet-bar rows
// (Budget, Amount Invoiced, Total Parts Cost Spent, Projection) on one shared
// scale, plus a budget-line marker and a budget meter (§78, by Dan's request,
// redesigned again against his own reference mockup — reference/Parts Cost
// Chart.dc.html — after a first §78 attempt built this as four ECharts bars;
// that shared-scale bullet-row layout has no natural ECharts shape, so it is
// hand-rolled CSS here, the same call §61's stacked bar made and for the same
// reason). Structure and proportions follow the mockup; colors and fonts map
// onto this app's own tokens instead of the mockup's literal palette, per the
// project's standing rule against duplicating a reference's literal theme.
//
//   §52: 4-5 separate horizontal bars — replaced because unlabeled rows made
//        "how do these relate" a multi-glance comparison instead of a
//        one-glance one.
//   §61: ONE vertical bar whose three segments were INCREMENTS stacked to a
//        shared total — replaced because Dan wanted the metrics separable
//        again, not folded into one bar's segments.
//   §78 (this one): back to separate rows, but every row now states its own
//        ABSOLUTE amount against a common max — not an increment — with a
//        direct dollar value beside every label, so "how do these relate" is
//        answered by bar length AND a number, not a stacked stack's math.
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
  // Now its own bar ("Budget") in the chart above the meter, per §78 — previously it
  // fed only the variance meter's baseline. Null when no selected job has a quote on
  // file, in which case the Budget bar is omitted rather than drawn at $0 (an absent
  // estimate must not read as a $0 target).
  estimated: number | null;
  // "Part Cost Budget Projection": purchased + estimate-to-purchase, the latter
  // being the app's Parts New ETC (= the month's opening estimate to complete
  // less what was spent this month). Computed in lib/parts-budget-projection.ts
  // — see there for the definition and for why Power BI's estimate-to-complete
  // measure can't be the estimate half. Null when there's no ETC month; the
  // Projection bar is then omitted rather than drawn with half the formula
  // missing.
  budgetProjection: { purchased: number; estimateToPurchase: number; total: number } | null;
}) {
  // Shared hover/tap tooltip (§59) — used only for the Projection-vs-Estimated
  // meter at the bottom, which stays hand-rolled CSS exactly as it was. The bars
  // above it carry no hover tooltip at all (§78, matching Dan's reference): every
  // row already states its own exact dollar value in plain text, so there is
  // nothing a tooltip would reveal that isn't already on screen.
  const tooltip = useChartTooltip();

  // Treat a ZERO quote as "nothing on file", not as a $0 target — an absent
  // estimate must not read as $0 estimated.
  const estimate = estimated != null && estimated > 0 ? estimated : null;
  const projection = budgetProjection?.total ?? null;

  // ── The four figures, as absolute values (§78) ────────────────────────────
  //
  // §61's version computed these as a running total (spentTop, projTop) because the
  // three segments were INCREMENTS stacked on each other — each segment's boundary had
  // to land exactly on a cumulative figure. Separate rows need no such nesting: each one
  // states its own absolute amount, scaled against the shared max below. The Math.max
  // guards stay regardless — they are not about stacking, they are the same defensive
  // floor as before, in case an upstream oddity ever inverted paid ≤ purchased ≤ projection.
  const invoiced = Math.max(0, paid);
  const spent = Math.max(invoiced, purchased); // "Total Parts Cost Spent"
  const projTotal = projection != null ? Math.max(spent, projection) : null; // "Projection" — omit the row when null

  const jobCtx = jobCount > 1 ? `Summed across ${jobCount} jobs` : "Selected job";
  const projDiff = estimate != null && projTotal != null ? projTotal - estimate : null;
  // Committed but not yet invoiced — the one figure the old stacked-bar tooltip
  // used to carry that isn't otherwise visible as its own row; shown as a small
  // caption under "Total Parts Cost Spent" instead, only when it's non-zero.
  const uninvoicedCommitted = spent - invoiced;

  // Top to bottom: Budget (the plan), then the two actuals building up to it, then the
  // forward-looking figure — the same order the requirement itself lists them in, and
  // the same order the reference mockup uses. Budget and Projection are OMITTED, not
  // drawn at $0, when there is nothing to show — same rule §61 used for the orange
  // segment, applied per-row instead of per-segment.
  //
  // Projection's color is the one STATUS-like exception to the sequential ramp above:
  // over estimate reads red, at-or-under reads green, matching OVER/UNDER's own names.
  // Falls back to the neutral "spent" blue only in the (rare) case there's a projection
  // but no estimate to compare it against, since "over/under" has no meaning there yet.
  const projColor = projDiff == null ? BAR_SPENT : projDiff > 0 ? OVER : UNDER;

  const maybeBars: (PartsBarRow | null)[] = [
    estimate != null ? { key: "budget", label: "Budget", value: estimate, color: BAR_BUDGET } : null,
    { key: "invoiced", label: "Amount Invoiced", value: invoiced, color: BAR_INVOICED },
    { key: "spent", label: "Total Parts Cost Spent", value: spent, color: BAR_SPENT },
    projTotal != null ? { key: "projection", label: "Projection", value: projTotal, color: projColor, emphasize: true } : null,
  ];
  const bars = maybeBars.filter((b): b is PartsBarRow => b != null);
  // All rows share one scale, per the reference mockup — each bar's fill is its own
  // value as a percentage of the largest value among the rows actually shown.
  const maxValue = Math.max(0, ...bars.map((b) => b.value));
  const pctOf = (v: number) => (maxValue > 0 ? Math.min(100, (v / maxValue) * 100) : 0);
  // The budget-line marker's position inside the Projection row is this SAME
  // percentage — Budget's own bar-fill width — reused as a tick mark on Projection's
  // track rather than recomputed, so the two always agree by construction.
  const budgetPct = estimate != null ? pctOf(estimate) : null;
  const showBudgetLine = budgetPct != null && projTotal != null;

  // ONE meter: where the job is HEADING against what it was sold for.
  //
  // Was two (purchased-vs-budget and projected-vs-budget), which showed the same
  // "87.2% of $636,234" twice on a job that has finished buying — two controls
  // saying one thing. Purchased is already its own bar above, so the only figure
  // that needed its own control is the forward-looking one.
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

  const varianceTooltip: TooltipData | null = variance
    ? {
        title: "Projection vs Estimated",
        sub: jobCtx,
        rows: [
          { color: projColor, label: "Projection", value: usd(variance.projection) },
          { label: "Estimated", value: usd(variance.estimate) },
          {
            label: variance.dollars > 0 ? "Over" : variance.dollars < 0 ? "Under" : "On estimate",
            value: usd(Math.abs(variance.dollars)),
            valueColor: variance.dollars > 0 ? OVER : variance.dollars < 0 ? UNDER : undefined,
            strong: true,
          },
        ],
      }
    : null;

  return (
    // The four KPI cards that used to sit beside this chart are gone by
    // request — every figure they showed is already labelled on the bar below,
    // so they were a second copy of the same numbers.
    // Horizontal padding tightened from the shared p-4 to px-3 (§79): on this card's narrow
    // 1fr grid column (~250px), p-4's 16px each side was costing ~12.5% of the card's width
    // on EVERY row — the title, the bars, and the meter alike, measured at 87.6% track-to-card
    // before this change. Vertical padding (py-4) is untouched — the ask was specifically
    // left/right space, and the row-to-row rhythm isn't the problem. 12px still reads as a
    // deliberate margin, not the bars touching the card's rounded corner.
    <div className={`${card("px-3 py-4")} flex h-full flex-col`}>
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

      {/* ── The four bullet-bar rows (§78) ────────────────────────────────────
          Budget, Amount Invoiced, Total Parts Cost Spent, Projection — each a
          label + exact dollar value above a horizontal track filled to its
          share of the largest value shown, per Dan's reference mockup
          (reference/Parts Cost Chart.dc.html). Every value is plain text, so
          nothing here depends on a hover to be read. */}
      <div className="flex-1 space-y-4">
        {bars.map((b) => (
          <div key={b.key}>
            <div className="flex items-baseline justify-between gap-3">
              <span
                className={`text-xs tracking-wide ${b.emphasize ? "font-semibold text-sdc-navy" : "font-medium text-sdc-gray-600"}`}
              >
                {b.label}
              </span>
              <span className="font-mono text-sm font-medium tabular-nums text-sdc-navy">{usd(b.value)}</span>
            </div>
            <div className="relative mt-1.5 h-3 overflow-hidden rounded-sm bg-sdc-gray-100">
              <div className="h-full rounded-sm" style={{ width: `${pctOf(b.value)}%`, background: b.color }} />
              {/* The budget-line marker: drawn only inside Projection's own track,
                  at Budget's own bar-fill percentage — where the plan falls
                  against where the money actually landed. */}
              {b.key === "projection" && showBudgetLine && (
                <div className="absolute -top-1 -bottom-1 w-px bg-sdc-navy/55" style={{ left: `${budgetPct}%` }} />
              )}
            </div>
            {b.key === "spent" && uninvoicedCommitted > 0.005 && (
              <p className="mt-1 text-note text-sdc-gray-400">{usd(uninvoicedCommitted)} committed, not yet invoiced</p>
            )}
          </div>
        ))}
        {showBudgetLine && estimate != null && (
          <div className="flex items-center gap-2 pt-1">
            <span className="inline-block h-3 w-px bg-sdc-navy/55" />
            <span className="font-mono text-note uppercase tracking-wide text-sdc-gray-400">
              Budget line — {usd(estimate)}
            </span>
          </div>
        )}
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
        <div className="mt-auto border-t border-sdc-border pt-3" {...(varianceTooltip ? tooltip.trigger(varianceTooltip) : {})}>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-semibold text-sdc-gray-600">Projection vs Estimated</p>
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

      {tooltip.node}
    </div>
  );
}
