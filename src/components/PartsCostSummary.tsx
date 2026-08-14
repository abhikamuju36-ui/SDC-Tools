"use client";

import { usd } from "@/components/ui/format";
import { card } from "@/components/ui/classnames";
import { reconcilePartsCostRounding, type PartsCostFinancials } from "@/lib/parts-cost-financials-shared";

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
// ── Width: a deliberate match to the ETC chart's own bar, not a column fit
// (2026-08-12, by request — "the two charts' bars should be the same width")
// ─────────────────────────────────────────────────────────────────────────
//
// Every earlier version of this constant (4.5rem, then 4rem via §81, then
// 5rem last pass) answered a DIFFERENT question — "how wide does the bar
// need to be to fill its own column, so the label/caption above it don't
// leave dead padding beside a too-narrow bar" — and kept growing because the
// label kept growing. That question is retired now: the bar's width is no
// longer derived from anything in THIS card. It is a literal copy of
// SectionHierarchyChart's own bar cap (JobHoursDashboard.tsx's `Bar`
// component, `max-w-5` = 1.25rem), so a Budget bar and an ETC-chart section
// bar read as the same physical width side by side, which is the whole ask.
//
// That means the bar is now narrower than its own label/caption most of the
// time (a 10-character dollar figure at text-xs/font-bold is ~65-70px, and
// "Projection" alone is ~57px — both well past 18.75px) — this is EXPECTED
// and no longer a bug the way it was when this constant used to chase the
// label. The column each bar sits in is a `flex-col items-center` (below),
// so it simply centers the narrow bar under whichever of {label, caption} is
// wider, the same way SectionHierarchyChart's own narrow bars sit centered
// under their own (comparatively wide) value labels — nothing here is doing
// anything that chart doesn't already do with an even bigger size gap.
const BAR_W = "1.25rem";

// ── Height: measured to share ONE baseline with the ETC chart beside it ──────
//
// The two cards are siblings in JobHoursDashboard's `lg:grid-cols-[2fr_1fr]`
// row, and SectionHierarchyChart (same file as that grid) draws its bars in a
// grid with a hard `height: 300`. Measured live at 15px root: that grid's
// bottom sat 74.4px BELOW these bars' bottom — the empty band under this
// card's bars, reported with the gap circled.
//
// 294 is not a guess: both cards start at the same y (one grid row), and
// everything above the bars in each card is fixed-height — the ETC chart's bar
// grid starts 72px below its card's top, and this card's bar BOX starts 77.6px
// below its own (padding + header + py-1 + the value label + its gap). So
// 372 - 77.6 ≈ 294 puts the two baselines on the same line BY CONSTRUCTION,
// which is what makes the alignment survive the drill-open state too: opening a
// section drill switches that grid from `items-stretch` to `items-start`, so
// this card stops being stretched — a height tuned against the STRETCHED
// spacer instead would drift the moment that happened.
//
// It also absorbs the 72.8px `flex-1` spacer that used to sit between the bars
// and the summary below, which is where the "excessive whitespace" came from:
// the card's own height is set by the taller ETC card next to it, and that
// spacer was soaking up the difference.
// 540, up from 414 (2026-08-14, by request — "increase vertical height ~30%")
// — the same +126 SectionHierarchyChart's own BAR_H just took (420→546), not
// a number picked independently.
//
// The "77.6px" derivation above is stale as of the value-label fix later in
// this file (2026-08-14, same day): that offset counted "the value label +
// its gap" as flow height sitting BEFORE the bar box, which was true only
// because the label used to live outside it. It now lives INSIDE the same
// BAR_H frame (packed against the bottom with the fill, so it tracks the
// fill's actual top instead of floating at the frame's top) — the frame
// itself starts higher up than 77.6px did, by roughly that label's own
// line-height plus its gap. BAR_H is unchanged and still kept in step with
// SectionHierarchyChart's own 546 (both took the identical +126 this pass),
// but re-deriving an exact new offset/baseline match is a live-measurement
// exercise neither this pass nor the one before it was asked to do.
const BAR_H = 540; // px — see above; keep in step with SectionHierarchyChart's own 546
// The caption band under each bar ("Budget" / "Actual / Projection").
//
// Used to be shared with a second constant (LEGEND_BOTTOM_OFFSET) that placed
// the legend band to end level with the bar box, back when the legend was an
// absolutely-positioned column stretched to BAR_H — removed 2026-08-12c along
// with that whole positioning scheme (see the legend's own comment below);
// CAPTION_H itself stays, since the two caption boxes still need it.
const CAPTION_H = "2rem";

// One segment's colour swatch + label + dollar value, as one row in a
// compact vertical list.
//
// ── History: pinned → horizontal group → vertical list (2026-08-12c/d) ─────
//
// The original design pinned each marker to its own segment's exact pixel
// midpoint (placeMarkers/MARKER_SLOT, removed — see git history if that math
// is ever needed again), on the theory that a marker should visually point
// at the thing it names. That held up fine until this card's bars ALSO grew
// (2026-08-12a/b, matching the ETC chart's height and bar width): three
// markers spread across a 414px bar, each anchored to a segment that can be
// a sliver or the whole bar, read as "stacked awkwardly, spread out
// vertically" — correct positioning, on a bar tall enough that "precisely
// where the segment sits" and "reads as one tidy group" stopped being the
// same thing.
//
// The first fix (2026-08-12c) replaced pinning with a horizontal flex-wrap
// group, capped at a fixed max-width so it would wrap to a second line
// instead of spreading. That made the CARD's own minimum width follow the
// wrap width instead of the bars beside it — "unbalanced and stretched",
// reported directly — because a flex-wrap child's contribution to an outer
// flex row's sizing is its unwrapped, one-line max-content width, not
// whatever width it actually wraps to at render time; the cap controlled the
// wrap, not the space this block asked its parent for.
//
// 2026-08-12d drops the cap and the wrap along with it: a plain vertical
// list (`flex-col`), one row per segment, sized to its own longest row —
// nothing here can be wider than "Left to be invoiced $41,418", which is
// narrower than the card already needs for its OWN captions ("Actual /
// Projection"), so this block was never actually the thing forcing the card
// wide; it only looked that way while wrapping was in the mix.
function SegmentMarker({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1 whitespace-nowrap">
      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="font-sans text-micro text-sdc-gray-600">{label}</span>
      {/* text-xs/font-bold/sdc-navy (2026-08-12b) — the same value-label
          treatment as the bars above; unchanged by this pass. The category
          name just before it stays smaller and un-bolded, on purpose — the
          same "modest label beside a bold figure" pairing the "Budget" /
          "Actual / Projection" captions under the bars already use. */}
      <span className="font-mono text-xs font-bold tabular-nums text-sdc-navy">{usd(value)}</span>
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
  financials,
  jobCount = 1,
}: {
  // The one Parts Cost reconciliation (src/lib/parts-cost-financials.ts,
  // audit "Audit Parts Cost Projection Formula Across All Projects",
  // 2026-08-15) — replaces the four separate props this card used to take
  // (`purchased`, `actual`, `estimated`, `budgetProjection`), each previously
  // re-derived by the page rather than read from one shared function. Same
  // underlying numbers, same formula; this just means every consumer of this
  // card reads them from the same place instead of risking a second
  // re-derivation drifting from the first.
  financials: PartsCostFinancials;
  // How many jobs these totals cover. The money figures aggregate correctly
  // across a multi-job selection (unlike the BOM below them), so the card
  // follows the slicer — it just has to say how many jobs it's adding up.
  jobCount?: number;
}) {
  const failedJobs = financials.failedJobs;
  // Treat a ZERO quote as "nothing on file", not as a $0 target — an absent
  // estimate must not read as $0 estimated. (getPartsCostFinancials already
  // applies this: budget is null unless quoted > 0.)
  const estimate = financials.budget;
  const hasProjection = financials.etc != null;

  // ── The Actual/Projection bar's three segments (2026-08-10) ───────────────
  //
  // Stacked as INCREMENTS, not the absolute figures themselves, which is what
  // stops the bar double-counting: Actual is already inside committed spend, and
  // committed spend is already inside Projection, so each segment above the first
  // is only the PART of the next figure that isn't already accounted for by the
  // segment below it. The three summed equal projTotal exactly.
  //
  // The BASE segment is Parts Actual — GL-posted spend — not `paid` (2026-08-10).
  // `paid` counts invoices flagged never to post to the general ledger, so it read
  // high against the job ledger people check this card against. The bar's total
  // height is unchanged: what moved out of segment 1 moved into segment 2, which
  // is where committed-but-not-on-the-ledger money belongs.
  const invoiced = financials.invoiced; // base segment — "Invoiced"
  const spent = financials.totalSpent; // everything committed (invoiced + left to invoice)
  const projTotal = financials.projection; // bar 2's own total height
  const spentIncrement = financials.leftToInvoice; // "Left to be invoiced"
  const projIncrement = financials.etc ?? 0; // "ETC"

  // ── Rounding that can't visibly contradict itself (audit finding) ─────────
  //
  // Rounding Invoiced/Left to Invoice/ETC to whole dollars independently, then
  // summing those three DISPLAYED numbers, doesn't always equal the displayed
  // Projection total rounded on its own — e.g. 23207.616 + 101371.554 +
  // 189298.04 = 313877.21 exactly, but round()+round()+round() of the three
  // parts = 313878, one dollar more than round(313877.21) = 313877. Nothing
  // in the underlying math is wrong; the fix is to round for DISPLAY only,
  // hierarchically: reconcile Invoiced+Left-to-invoice against their own
  // (separately rounded) "Total Parts Cost Spent" first, then let ETC absorb
  // whatever's left to reach the (separately rounded) Projection total. That
  // guarantees both displayed subtotals — Total Parts Cost Spent, and
  // Projection — always equal the sum of the segment figures shown beside them.
  const [invoicedDisplay, leftToInvoiceDisplay] = reconcilePartsCostRounding([invoiced, spentIncrement]);
  const totalSpentDisplay = invoicedDisplay + leftToInvoiceDisplay;
  const projTotalDisplay = Math.round(projTotal);
  const etcDisplay = hasProjection ? Math.max(0, projTotalDisplay - totalSpentDisplay) : 0;

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
  // A percentage-of-scale as an actual PIXEL height against BAR_H — see the
  // value-label fix below for why this replaced the old `${pct}%` heights.
  const barPx = (percent: number) => (BAR_H * percent) / 100;

  // Segments bottom-to-top, each sized against the SAME shared scale as
  // Budget — Bar 2's own rendered height is the sum of these three, which
  // equals pct(projTotal) exactly, so "the bar's total height is Projection"
  // still holds. Always both actuals; the projection segment only exists (and
  // is only labelled) when there IS a projection to show — you can't state a
  // share of a figure that was never computed.
  // `value` here is the RECONCILED whole-dollar figure (see above) — what's
  // displayed beside the bar — while `heightPct` still scales off the raw,
  // full-precision figure, since the bar's geometry has no rounding-sum
  // problem to begin with (only the printed dollar labels do).
  const segments: { key: string; label: string; value: number; color: string; heightPct: number }[] = [
    { key: "invoiced", label: "Invoiced", value: invoicedDisplay, color: BAR_INVOICED, heightPct: pct(invoiced) },
    { key: "left-to-invoice", label: "Left to be invoiced", value: leftToInvoiceDisplay, color: BAR_SPENT, heightPct: pct(spentIncrement) },
  ];
  if (hasProjection) {
    segments.push({ key: "etc", label: "ETC", value: etcDisplay, color: BAR_PROJECTED, heightPct: pct(projIncrement) });
  }
  // Chips read in the same top-to-bottom order the segments stack visually —
  // the topmost segment ("ETC", when present) listed first — even though
  // nothing about the compact layout below is positioned per-segment any
  // more (2026-08-12c). Keeping this order is still worth doing: it's the
  // one remaining thread connecting "which chip is this" back to "where in
  // the bar does that dollar figure live".
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
  const noPartsActivity = spent === 0 && projTotal === 0;

  const variance =
    estimate != null && financials.variance != null && !noPartsActivity
      ? {
          estimate,
          dollars: financials.variance, // + = over
          pct: financials.variancePct! / 100,
        }
      : null;

  return (
    // The four KPI cards that used to sit beside this chart are gone by
    // request — every figure they showed is already labelled below.
    // Horizontal padding tightened from the shared p-4 to px-3 (§79), then to
    // px-2 (§81, alongside the row's 85/15 split): on this card's ~15%-of-row
    // column, every rem of horizontal padding is a bigger share of the card
    // than it was at 33% or even 20%. Vertical padding (py-4) is untouched.
    //
    // Deliberately NOT `min-w-0` (§81): that would let the 3fr grid track in
    // JobHoursDashboard shrink this card to EXACTLY 15%, no matter what —
    // and on a job with 8-figure dollar amounts, 15% is narrower than the
    // (unbreakable) money text needs, which without this is a card that
    // shrinks until its own numbers overlap. Leaving the browser's ordinary
    // "a grid item never shrinks below its own content's minimum" behaviour
    // in place instead means the row renders at a true 85/15 whenever the
    // figures fit that (every job seen so far), and gives this card only the
    // few extra pixels its own numbers actually need on the rare job that
    // doesn't — the same "legible over exact" trade this file's own history
    // keeps making, just enforced one level up instead of inside the card.
    <div className={`${card("px-2 py-4")} flex h-full flex-col`}>
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
          from the next. The three segment rows sit in a compact vertical
          list beside the bars (2026-08-12d), ordered to match the bar's
          top-to-bottom stacking, so no row can ever overlap another and
          nothing here can be wider than its own longest row — see that
          list's own comment below.

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
          visible gap. Widening the bar to fill that column (2026-08-11d
          through 2026-08-12a) made `gap-1.5` the real, whole gap between the
          two bars — measured at the time: dropped from ~44.6px to exactly
          5.625px once the bar matched its column's width.

          2026-08-12b supersedes that specific fix, by request: the bar is
          now a fixed 1.25rem — matching the ETC chart's own bar width rather
          than filling this column — so the dead padding beside a narrower
          bar is BACK, deliberately. The apparent gap between the two bars
          reads close to that original ~44.6px again, not 5.625px; this is
          the direct, accepted cost of "same bar width as the other chart"
          rather than a regression of the §81/2026-08-11d fix. Both bars
          still center correctly under their own label/caption (`items-center`
          on each column, untouched) and stay the SAME width as each other,
          which is what "balanced" asks for — it just no longer also means
          "touching". */}
      {/* `items-center`, not `items-end` (2026-08-12c) — the legend group is
          no longer stretched to BAR_H (see its own comment), so it's a much
          shorter block than the bar pair beside it; centering the two
          against each other is what makes a short legend and a tall bar
          pair read as one balanced row instead of the legend looking glued
          to the bottom. This only affects how these TWO top-level children
          align against each other — the bar pair's OWN internal alignment
          (Budget vs Actual/Projection, `items-end` on the nested row below)
          is untouched. */}
      <div className="flex items-center justify-center gap-1 py-1">
        {/* Bar pair: compact and content-sized, NOT `flex-1` — an intervening
            pass (§81) made this row and both columns `flex-1` so the pair
            would "grow to use whatever width the card has left", which
            pushed Budget and Actual/Projection apart instead: each column
            grew past its own bar's `maxWidth: BAR_W`, and the leftover width
            became padding around an already-centered bar — the exact kind of
            artificial gap this card's whole history has been about removing.
            Reverted here: dropping `flex-1` (still WITHOUT `min-w-0`, so the
            automatic per-column minimum below still stops the two dollar
            labels from ever colliding) lets the pair size itself to its
            content, so the outer row's `justify-center` centers a genuinely
            compact group, and `gap-1.5` — the same pair spacing the Estimate
            to Complete vs Actual chart uses between its own Quoted/Actual
            bars (SectionHierarchyChart's `Bar` pair) — is once again the
            real, whole gap between the two bars instead of being swallowed
            by column growth.

            `min-w-0` was tried (separately) and reverted: it let the columns
            shrink past their labels, and the two dollar figures overlapped by
            ~23px at a 1440px viewport (measured) — the labels are unbreakable
            single tokens ("$367,170"), so a column narrower than its label
            can only end in overlap, never a wrap. Each bar box is now a FIXED
            `width: BAR_W` (2026-08-12b), not `w-full` of its column — see
            BAR_W's own comment for why the bar deliberately no longer tracks
            the column at all. A long dollar label (a big job's "$1,525,498")
            still can't overlap its neighbour, for the same reason as before:
            it's the column's own content-based minimum doing that, same as
            it always has, independent of whatever the bar itself is doing. */}
        <div className="flex items-end gap-1.5">
          <div className="flex flex-col items-center gap-1.5">
            {/* ── Value label anchored to the bar's own top, not the frame's
                (2026-08-14, by request — "not properly anchored... floating
                too far left/right") ────────────────────────────────────────
                The label used to sit in normal flow ABOVE this fixed BAR_H
                frame, so it always hovered at the frame's top regardless of
                how tall the actual fill was — correct only when the fill
                happened to reach 100%, adrift by however much it didn't the
                rest of the time. SectionHierarchyChart's own `Bar` (the
                Hours chart this is meant to match) never has this problem
                because label and bar are packed together, bottom-aligned,
                inside their OWN full-height frame — the same fix applied
                here: this div IS the BAR_H reference frame (width/height set
                below), `justify-end` packs [label, fill] to its bottom edge,
                so the label sits exactly one gap above wherever the fill's
                top actually is, centered on it by the same `items-center`
                that already centered the frame under its caption.
                text-xs/font-bold/text-sdc-navy unchanged from before
                (2026-08-12, consistency with the ETC chart's own bar
                labels); leading-none + mb-0.5 added to match that chart's
                label-to-bar gap exactly (SectionHierarchyChart's `Bar`). */}
            <div className="flex flex-col items-center justify-end" style={{ width: BAR_W, height: BAR_H }}>
              <span className="mb-0.5 whitespace-nowrap font-mono text-xs font-bold leading-none tabular-nums text-sdc-navy">
                {estimate != null ? usd(estimate) : "—"}
              </span>
              {/* No background — a bg-sdc-gray-100 "track" here used to fill
                  the full frame regardless of value, so a bar under 100% of
                  maxValue showed a gray shortfall above its real fill that
                  read as the bar extending further than its actual number.
                  The card's own background shows through above the fill
                  instead. Height is now a PIXEL value (barPx), not a
                  percentage: as a plain flow child (no longer absolutely
                  positioned against a same-height parent) a `%` height here
                  would only resolve at all because the parent's height is
                  itself a definite pixel value — barPx says so directly and
                  keeps the segments below on the identical footing. */}
              {estimate != null && <div className="w-full rounded-t-sm" style={{ height: barPx(pct(estimate)), background: BAR_BUDGET }} />}
            </div>
            <div className="flex items-start justify-center text-center text-note font-medium leading-tight text-sdc-gray-600" style={{ height: CAPTION_H }}>Budget</div>
          </div>

          <div className="flex flex-col items-center gap-1.5">
            {/* Same fix as Budget's frame just above — see its comment. */}
            <div className="flex flex-col items-center justify-end" style={{ width: BAR_W, height: BAR_H }}>
              <span className="mb-0.5 whitespace-nowrap font-mono text-xs font-bold leading-none tabular-nums text-sdc-navy">{usd(projTotalDisplay)}</span>
              {/* The three segments stack bottom-to-top inside their own
                  sub-column (flex-col-reverse: first array item —
                  "Invoiced" — ends up at the bottom, matching before).
                  Each gets a PIXEL height (barPx), so the stack's rendered
                  height is exactly the sum of Invoiced + Left to be invoiced
                  + ETC with no percentage-of-an-auto-height-parent ambiguity
                  — it sums to barPx(pct(projTotal)) exactly, still no
                  fourth invisible segment padding it out further. */}
              <div className="flex w-full flex-col-reverse">
                {segments.map((s, i) => (
                  <div key={s.key} className={`w-full flex-shrink-0 ${i === segments.length - 1 ? "rounded-t-sm" : ""}`} style={{ height: barPx(s.heightPct), background: s.color }} />
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

        {/* The three segment rows, as one compact vertical list
            (2026-08-12d, by request — the horizontal flex-wrap version just
            before this "caused the layout to become unbalanced and
            stretched"). No absolute positioning, no `placeMarkers` collision
            math (both removed with the pinned-to-segment version this
            replaced), and — this time — no wrap cap either: `flex-col` never
            asks its parent for more than its own widest ROW, so it can't
            drag the card wider the way the flex-wrap attempt did (see
            SegmentMarker's own header for exactly how that happened).
            `shrink-0` still matters here for the same reason it does
            everywhere else in this card: a block that gets squeezed below
            its own content's width can only end in overlap, and this one's
            content is unbreakable dollar figures. */}
        <div className="flex shrink-0 flex-col gap-1">
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
      {/* The AMOUNT carries the emphasis, not the whole line (2026-08-11f, by
          request): navy + bold + `text-sm` against the label's muted `text-note`
          makes the figure the thing the eye lands on, without turning a quiet
          caption into a second heading competing with "Projection vs Budget"
          right beneath it. The expression is untouched — still exactly the
          bar's own bottom two segments. */}
      {/* `mt-1`, not `mt-2` (2026-08-11f): the taller bars consumed the whole
          72.8px `flex-1` spacer that used to sit here, which left this card's
          natural height 3.5px ABOVE the ETC card's — and since the two stretch
          to whichever is taller, that made BOTH cards grow. Reclaiming 3.75px
          here puts the ETC card back in charge of the row height (so the card
          height is preserved exactly, as asked) and tightens the gap between
          the bars and this summary at the same time. */}
      <p className="mt-1 text-note text-sdc-gray-400">
        Total Parts Cost Spent:{" "}
        <span className="font-mono text-sm font-bold tabular-nums text-sdc-navy">{usd(totalSpentDisplay)}</span>
      </p>

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
        </div>
      )}
    </div>
  );
}
