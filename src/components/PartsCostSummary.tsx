"use client";

import { usd } from "@/components/ui/format";
import { card } from "@/components/ui/classnames";

// Fixed palette (2026-08-11, by request) — no longer the SDC-blue ramp, but
// still fixed constants rather than anything data-derived, so the same dollar
// role is always the same colour on every job and every screen. Certainty
// still reads bottom-to-top (darkest = actually spent and most certain,
// yellow = still a forecast), same idea the blue ramp encoded, new colours.
const BAR_BUDGET = "#5489EF";
const BAR_INVOICED = "#061D39"; // Invoiced — GL-posted, most certain
const BAR_SPENT = "#AACEE8"; // Left to be invoiced — committed, not yet on the ledger
const BAR_PROJECTED = "#FFDE51"; // ETC — forecast

// Height taller than before (2026-08-10, by request) so the second bar's
// three segments have room to read as distinct shapes rather than thin stripes.
//
// Width (2026-08-11d) is NOT `max-w-5`/1.25rem any more — that matched the
// ETC chart's own bar cap, but that chart's bars sit under a TINY value label
// (2-3 digit hours, `text-micro`), while these sit under a 6-8 digit dollar
// figure at a much bigger font (`text-sm font-semibold`, measured ~58-72px
// wide). At the old 1.25rem/18.75px, each bar was centered inside a column
// the LABEL had forced much wider than the bar itself, and that leftover
// padding — not the intentional `gap-1.5` — was almost the entire ~45px gap
// between the two bars. Widening the bar to fill that same column (measured:
// the label needs roughly 58-80px depending on the dollar amount) removes
// the padding at its source, so gap-1.5 is once again the real, and only,
// gap between the two bars, same as the ETC chart's own bar pairs.
const BAR_W = "4.5rem";
const BAR_H = 220; // px

// One segment's colour swatch + label + dollar value — a normal block in
// normal flex flow, NOT absolutely positioned against the bar. An earlier
// version placed each marker at its segment's precise pixel midpoint, which
// looked right until a label wrapped onto two lines (this card's ~250px
// column has no room for "Committed, not yet invoiced $44,774" on one line)
// and started overlapping its neighbour — pixel maths has no way to know how
// tall a wrapped label will actually render. Normal flow can't make that
// mistake: the browser gives each marker exactly the height its own text
// needs, so two neighbours are physically incapable of occupying the same
// space, however much either wraps. Declared at module scope, not inside
// PartsCostSummary — a component defined during render is re-created (and its
// state reset) on every render, which react-hooks/static-components rejects.
function SegmentMarker({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-start gap-1.5">
      <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className="text-xs leading-snug text-sdc-gray-600">
        {label}
        <br />
        <span className="font-mono text-xs font-semibold tabular-nums text-sdc-navy">{usd(value)}</span>
      </span>
    </div>
  );
}

// Parts Cost money block for the Job Hour Details page — the app's version of
// the Power BI report's Parts Cost visual.
//
// ── History ───────────────────────────────────────────────────────────────
//   §52: 4-5 separate horizontal bars — replaced because unlabeled rows made
//        "how do these relate" a multi-glance comparison instead of a
//        one-glance one.
//   §61: ONE vertical bar whose three segments were increments stacked to a
//        shared total — replaced because Dan wanted the metrics separable
//        again, not folded into one bar's segments.
//   §78: back to four separate rows, each stating its own ABSOLUTE amount
//        against a common max, with a direct dollar value beside every label.
//   2026-08-10a: two vertical bars on ONE shared scale — Budget on its own,
//        Actual/Projection as a single cumulative bar summing to Projection.
//   2026-08-10b: tried scaling each bar to ITSELF instead, so Projection
//        couldn't influence Budget's height at all — reverted the same day:
//        the two bars are meant to be compared by height (a bigger number
//        must draw taller), which a self-scaled Budget bar can never show.
//   2026-08-10c: back to the shared scale from (a), with the actual bug fixed
//        instead — the three segment labels beside Bar 2 now sit in normal
//        document flow rather than pinned to each segment's exact pixel
//        position, which is what let two labels overlap the moment one of
//        them wrapped onto a second line.
//   2026-08-11a: colors switched to a fixed palette (#5489EF Budget;
//        #061D39/#AACEE8/#FFDE51 for the three Bar-2 segments) instead of
//        the SDC-blue ramp. Same three values, same stacking, same shared
//        scale — colors and labels only.
//   2026-08-11b (this one, by request): Budget and Bar 2 tightened into one
//        gap-1.5 pair (same spacing the ETC chart's own Quoted/Actual bar
//        pairs use) instead of sitting a full gap-4 apart, and the three
//        segment labels renamed again — Invoiced / Left to be invoiced / ETC
//        — replacing the (a) names. Colors, values and stacking unchanged.
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
  actual,
  estimated,
  budgetProjection,
  jobCount = 1,
  failedJobs = 0,
}: {
  purchased: number;
  // Parts ACTUAL — GL-posted spend, the app's one definition of it (see
  // getPartsActualByJob in lib/sync-totaleto.ts). This card's first segment and
  // its "Total Parts Cost Spent" caption used to read `paid` and `purchased`
  // respectively; both overstated what the job had actually spent, which is what
  // put job 1116 at ~$400K against a ~$340K job ledger (2026-08-10).
  //
  // `paid` used to be a prop here and is deliberately gone: it counts invoices
  // flagged never to post to the general ledger, so it is neither the actual
  // (that's `actual`) nor the commitment (that's `purchased`) and the card showed
  // it as both at different times. Nothing on screen needs a third figure between
  // the two.
  actual: number;
  // How many jobs these totals cover. The money figures aggregate correctly
  // across a multi-job selection (unlike the BOM below them), so the card
  // follows the slicer — it just has to say how many jobs it's adding up.
  jobCount?: number;
  // Jobs whose TotalETO parts pull failed. Their lines are missing from the
  // totals, so the card says so instead of presenting a short figure as if it
  // were the whole picture — a silently-dropped job reads as "nothing bought".
  failedJobs?: number;
  // The Parts Cost Quoted figure from the Projects tab (Job.costQuoted), summed across
  // the selected jobs — per Dan, "Estimated" here is ALWAYS the quoted cost, i.e. the
  // Budget this chart's first bar draws. Null when no selected job has a quote on
  // file, in which case the Budget bar is drawn empty rather than at $0 (an absent
  // estimate must not read as a $0 target).
  estimated: number | null;
  // "Part Cost Budget Projection": purchased + estimate-to-purchase, the latter
  // being the app's Parts New ETC (= the month's opening estimate to complete
  // less what was spent this month). Computed in lib/parts-budget-projection.ts
  // — see there for the definition and for why Power BI's estimate-to-complete
  // measure can't be the estimate half. Null when there's no ETC month; the
  // second bar's top segment is then omitted rather than drawn with half the
  // formula missing.
  budgetProjection: { actual: number; committedNotPosted: number; estimateToPurchase: number; total: number } | null;
}) {
  // Treat a ZERO quote as "nothing on file", not as a $0 target — an absent
  // estimate must not read as $0 estimated.
  const estimate = estimated != null && estimated > 0 ? estimated : null;
  const projection = budgetProjection?.total ?? null;
  const hasProjection = projection != null;

  // ── The Actual/Projection bar's three segments (2026-08-10) ───────────────
  //
  // Stacked as INCREMENTS, not the absolute figures themselves, which is what
  // stops the bar double-counting: Actual is already inside committed spend, and
  // committed spend is already inside Projection, so each segment above the first
  // is only the PART of the next figure that isn't already accounted for by the
  // segment below it. The three summed equal projTotal exactly — the Math.max
  // guards are the same defensive floor this component has always had, in case an
  // upstream oddity ever inverted actual ≤ purchased ≤ projection.
  //
  // The BASE segment is Parts Actual — GL-posted spend — not `paid` (2026-08-10).
  // `paid` counts invoices flagged never to post to the general ledger, so it read
  // high against the job ledger people check this card against. The bar's total
  // height is unchanged: what moved out of segment 1 moved into segment 2, which
  // is where committed-but-not-on-the-ledger money belongs.
  const invoiced = Math.max(0, actual); // base segment — "Invoiced"
  const spent = Math.max(invoiced, purchased); // everything committed
  const projTotal = hasProjection ? Math.max(spent, projection!) : spent; // bar 2's own total height
  const spentIncrement = Math.max(0, spent - invoiced); // "Left to be invoiced"
  const projIncrement = Math.max(0, projTotal - spent); // "ETC"

  // ── ONE shared scale for both bars (2026-08-10c, by request) ──────────────
  //
  // Budget and Bar 2 (Actual/Projection) are plotted against the SAME maximum,
  // so a taller bar always means more dollars regardless of which side it's
  // on — $1,566,916 draws visibly taller than $1,300,000. A previous version
  // scaled each bar to itself so Projection could never influence Budget's own
  // height; by request that's reverted, since the two bars ARE meant to be
  // compared by height, and the fixed-scale version made every job's Budget
  // bar look identical regardless of its actual size.
  const maxValue = Math.max(1, estimate ?? 0, projTotal);
  const pct = (v: number) => Math.min(100, (v / maxValue) * 100);

  // Segments bottom-to-top, each sized against the SAME shared scale as
  // Budget — Bar 2's own rendered height is the sum of these three, which
  // equals pct(projTotal) exactly, so "the bar's total height is Projection"
  // still holds. Always both actuals; the projection segment only exists (and
  // is only labelled) when there IS a projection to show — you can't state a
  // share of a figure that was never computed.
  const segments: { key: string; label: string; value: number; color: string; heightPct: number }[] = [
    { key: "invoiced", label: "Invoiced", value: invoiced, color: BAR_INVOICED, heightPct: pct(invoiced) },
    { key: "left-to-invoice", label: "Left to be invoiced", value: spentIncrement, color: BAR_SPENT, heightPct: pct(spentIncrement) },
  ];
  if (hasProjection) {
    segments.push({ key: "etc", label: "ETC", value: projIncrement, color: BAR_PROJECTED, heightPct: pct(projIncrement) });
  }
  // Labels read top-to-bottom in the same order the segments stack visually —
  // the topmost segment ("ETC", when present) listed first — even though the
  // label column itself is laid out in normal flow rather than pinned to
  // each segment's exact pixel position (see SegmentMarker).
  const labelOrder = [...segments].reverse();

  // ONE meter: where the job is HEADING against what it was sold for.
  //
  // Was two (purchased-vs-budget and projected-vs-budget), which showed the same
  // "87.2% of $636,234" twice on a job that has finished buying — two controls
  // saying one thing. Purchased is already in the bars above; the only figure
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

  return (
    // The four KPI cards that used to sit beside this chart are gone by
    // request — every figure they showed is already labelled below.
    // Horizontal padding tightened from the shared p-4 to px-3 (§79): on this card's narrow
    // 1fr grid column (~250px), p-4's 16px each side was costing ~12.5% of the card's width
    // on EVERY row. Vertical padding (py-4) is untouched.
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

      {/* ── The two bars (2026-08-11) ────────────────────────────────────────
          Budget and Bar 2 sit in their OWN tight-gap row (`gap-1.5`) — the
          same pair spacing the Estimate to Complete vs Actual chart uses
          between its own Quoted/Actual bars (SectionHierarchyChart's `Bar`
          pair) — nested inside the wider row that also holds the legend, so
          tightening the pair doesn't also crowd the labels beside it. Budget
          and Bar 2 share one scale (`pct`), so Budget draws visibly shorter
          than a larger Actual/Projection bar. Bar 2 is one cumulative column
          (Invoiced, then Left to be invoiced, then ETC); its OWN rendered
          height is the sum of the three, which is Projection's own share of
          the shared scale. No border on the fills, no reference lines, no
          brackets — the colour step is the only thing separating one segment
          from the next. The three segment labels sit in a normal-flow column
          to the right, ordered to match the bar's top-to-bottom stacking, so
          no label can ever overlap another regardless of how much any one of
          them wraps.

          Both captions are pinned to a fixed `h-8` box (2026-08-11b) — NOT
          left to size to their own text — because a flex column's width is
          set by its WIDEST child, and one-line "Actual / Projection" was
          wider than either bar, pushing bar 2 outward inside its own column
          and reopening the gap `gap-1.5` was supposed to close. Wrapping it
          onto two shorter lines fixes the width; the fixed caption height
          fixes a second-order effect of that same fix — a 2-line caption is
          taller than "Budget"'s 1 line, and `items-end` bottom-aligns the
          two columns AS WHOLES, so without a shared reserved height the
          taller column would push its own bar down, breaking the shared
          baseline the two bars are supposed to sit on.

          The captions were never the whole story, though (2026-08-11d) — the
          DOLLAR VALUE above each bar is wider still (measured ~58-80px
          depending on the amount), so even with the caption fixed the column
          stayed exactly that much wider than the bar, and the leftover
          padding on each side of a too-narrow bar was almost the entire
          visible gap. See BAR_W's own comment above — the bar itself is now
          widened to fill that same column, which is what actually makes
          `gap-1.5` the real gap between the two bars instead of a small
          fraction of it. Verified against a real DOM measurement (a static
          reproduction of this exact markup), not by eye: gap dropped from
          ~44.6px to exactly 5.625px (`gap-1.5` at this app's 15px root) once
          the bar matched its column's width. */}
      <div className="flex items-end justify-center gap-4 py-1">
        <div className="flex items-end gap-1.5">
          <div className="flex flex-col items-center gap-1.5">
            <span className="font-mono text-sm font-semibold tabular-nums text-sdc-navy">{estimate != null ? usd(estimate) : "—"}</span>
            <div className="relative overflow-hidden rounded-sm bg-sdc-gray-100" style={{ width: BAR_W, height: BAR_H }}>
              {estimate != null && (
                <div className="absolute inset-x-0 bottom-0 rounded-t-sm" style={{ height: `${pct(estimate)}%`, background: BAR_BUDGET }} />
              )}
            </div>
            <div className="flex h-8 items-start justify-center text-center text-note font-medium leading-tight text-sdc-gray-600">Budget</div>
          </div>

          <div className="flex flex-col items-center gap-1.5">
            <span className="font-mono text-sm font-semibold tabular-nums text-sdc-navy">{usd(projTotal)}</span>
            <div className="relative overflow-hidden rounded-sm bg-sdc-gray-100" style={{ width: BAR_W, height: BAR_H }}>
              <div className="absolute inset-x-0 bottom-0 flex h-full flex-col-reverse">
                {segments.map((s, i) => (
                  <div key={s.key} className={`w-full flex-shrink-0 ${i === segments.length - 1 ? "rounded-t-sm" : ""}`} style={{ height: `${s.heightPct}%`, background: s.color }} />
                ))}
              </div>
            </div>
            <div className="flex h-8 items-start justify-center text-center text-note font-medium leading-tight text-sdc-gray-600">
              Actual /
              <br />
              Projection
            </div>
          </div>
        </div>

        {/* The three segment markers, one per line with real spacing between
            them — normal flow, not pinned to the bar's pixels (see
            SegmentMarker for why). Centred against the taller of the two
            bars' worth of vertical space so it doesn't look stranded when
            both bars are short. Fixed max-width, NOT `flex-1` (2026-08-11) —
            a flex-1 legend claims every pixel of space the row's own
            `justify-center` would otherwise have distributed, which is what
            made the whole bar group read left-aligned: there was no leftover
            space left to center it WITH. Bounding this block's width instead
            gives the row something finite to center as a whole. */}
        <div className="flex min-w-0 max-w-[9.5rem] flex-col justify-center gap-3" style={{ minHeight: BAR_H * 0.6 }}>
          {labelOrder.map((s) => (
            <SegmentMarker key={s.key} color={s.color} label={s.label} value={s.value} />
          ))}
        </div>
      </div>

      {/* The spacer now comes BEFORE "Total Parts Cost Spent" (2026-08-11c,
          by request) — it used to sit after it, which pinned Projection vs
          Budget to the card's bottom edge but left this caption stranded
          right under the bars with a tall gap beneath it. Moving the spacer
          up carries both down together, so the caption sits immediately
          above Projection vs Budget instead of immediately below the bars. */}
      <div className="flex-1" />

      {/* "Total Parts Cost Spent" is a named figure people look for.
          2026-08-11 (by request): Invoiced + Left to be invoiced — i.e. the
          bar's bottom two segments, `spent` — NOT the GL-posted-only figure
          this caption showed 2026-08-10 through 2026-08-11a. That earlier
          choice existed because a cumulative committed total once read
          $399,177 on job 1116 against a $349,732 ledger; the two segments
          summed here are the exact same two dollar figures the legend prints
          (Invoiced + Left to be invoiced), so this reconciles with what's on
          screen rather than with the ledger. ETC is deliberately excluded —
          it's a forecast, not spend. */}
      <p className="mt-2 text-note text-sdc-gray-400">Total Parts Cost Spent: {usd(invoiced + spentIncrement)}</p>

      {/* Projection vs Budget — the one figure that says whether this job
          lands over what it was sold for, while there's still time to act.
          Its own border-t + pt-3 below separates it from the caption now
          immediately above it (the flex-1 spacer no longer sits between
          them, so this border is the only remaining gap between the two). */}
      {/* No activity yet: say that, rather than dressing a standing start up
          as a 100% saving. Only shown when there IS a quote to be measured
          against — with no estimate on file there's nothing to report. */}
      {variance == null && noPartsActivity && estimate != null && (
        <div className="border-t border-sdc-border pt-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-semibold text-sdc-gray-600">Projection vs Budget</p>
            <p className="font-heading text-sm font-bold text-sdc-muted">
              No parts activity yet · {usd(estimate)} budget
            </p>
          </div>
        </div>
      )}

      {variance != null && (
        <div className="border-t border-sdc-border pt-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-semibold text-sdc-gray-600">Projection vs Budget</p>
            <p className="font-heading text-sm font-bold tabular-nums">
              {/* Zero handled separately: "0.0% over" reads as a rounding
                  artefact where "on budget" is unambiguous. */}
              {Math.abs(variance.pct) < 0.0005 ? (
                <span className="text-sdc-muted">On budget · {usd(variance.estimate)}</span>
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
