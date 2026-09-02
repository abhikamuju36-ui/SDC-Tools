"use client";

import { usd } from "@/components/ui/format";
import { card } from "@/components/ui/classnames";
import { reconcilePartsCostRounding, sharedBarMax, scaleToPct, type PartsCostFinancials } from "@/lib/parts-cost-financials-shared";
import type { PartsDrillMode } from "@/components/PartsCostDrill";

// Fixed palette (2026-08-11, by request) — no longer the SDC-blue ramp, but
// still fixed constants rather than anything data-derived, so the same dollar
// role is always the same colour on every job and every screen. Certainty
// still reads bottom-to-top (darkest = actually spent and most certain,
// yellow = still a forecast), same idea the blue ramp encoded, new colours.
const BAR_BUDGET = "#5489EF";
const BAR_INVOICED = "#061D39"; // Invoiced — GL-posted, most certain
const BAR_SPENT = "#AACEE8"; // Left to be invoiced — committed, not yet on the ledger. Informational-only chip swatch since 2026-08-17; no longer a bar fill.
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
function SegmentMarker({ color, label, value, note, informational }: { color: string; label: string; value: number; note?: string; informational?: boolean }) {
  return (
    <div className="flex items-center gap-1 whitespace-nowrap">
      {/* `informational` (2026-08-17): an OUTLINE swatch, not a filled one — this
          chip names a figure that is NOT one of the bar's own stacked segments
          (see the double-count fix below), so it deliberately doesn't look like
          one. A filled dot here would read as "this color is somewhere in that
          bar", which is exactly the misreading this fix removes. */}
      <span
        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${informational ? "border border-current bg-transparent" : ""}`}
        style={informational ? { borderColor: color } : { background: color }}
      />
      <span className="font-sans text-micro text-sdc-gray-600">{label}</span>
      {/* text-xs/font-bold/sdc-navy (2026-08-12b) — the same value-label
          treatment as the bars above; unchanged by this pass. The category
          name just before it stays smaller and un-bolded, on purpose — the
          same "modest label beside a bold figure" pairing the "Budget" /
          "Actual / Projection" captions under the bars already use. */}
      <span className="font-mono text-xs font-bold tabular-nums text-sdc-navy">{usd(value)}</span>
      {note && <span className="font-sans text-micro italic text-sdc-muted">{note}</span>}
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
//   2026-08-17 (double-count fix, by request): Bar 2 dropped from three
//        stacked segments to TWO — Invoiced, then ETC — because "Left to be
//        invoiced" was already inside ETC (ETC draws down by GL-posted spend
//        only, never by an open PO's balance — see
//        parts-budget-projection.ts's header for the mechanism and real
//        numbers). Left to be invoiced is still shown, as an informational
//        chip beside the bars labelled "Included in ETC", not as a segment.
//        "Total Parts Cost Spent" (Invoiced + Left to be invoiced) is
//        unchanged — that sum was never the bug.
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
  onDrill,
  drillMode = null,
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
  // ── Drill-through (2026-09-02) ────────────────────────────────────────────
  //
  // The card raises WHICH part of the bar was clicked; the panel itself is rendered
  // by the page, full width below the charts row, because an eleven-column part-level
  // table cannot be read in the ~15% column this card occupies. Optional, so the card
  // still renders as a plain summary anywhere with nowhere to put a drill.
  onDrill?: (mode: PartsDrillMode) => void;
  /** Which drill is open, so the segment that opened it can show it is the active one. */
  drillMode?: PartsDrillMode | null;
}) {
  const failedJobs = financials.failedJobs;
  // Treat a ZERO quote as "nothing on file", not as a $0 target — an absent
  // estimate must not read as $0 estimated. (getPartsCostFinancials already
  // applies this: budget is null unless quoted > 0.)
  const estimate = financials.budget;
  const hasProjection = financials.etc != null;

  // ── The Actual/Projection bar's TWO segments (2026-08-17 fix) ─────────────
  //
  // Used to be three, stacked as increments — Invoiced, then Left to be
  // invoiced, then ETC — on the theory that Actual sits inside committed
  // spend and committed spend sits inside Projection. That theory doesn't
  // hold: ETC (the app's Parts New ETC) is drawn down by GL-posted spend
  // only, never by an open PO's balance, so "Left to be invoiced" money stays
  // fully present inside ETC until it's actually invoiced — stacking it a
  // second time between Invoiced and ETC double-counted it. See
  // parts-budget-projection.ts's header for the full mechanism and the real
  // numbers that surfaced it.
  //
  // The bar now stacks exactly what Projection sums: Invoiced (GL-posted,
  // most certain) then the remaining residual on top — usually the ETC
  // forecast, but as of 2026-08-19 (job 1119, Karl Storz — Projection reading
  // BELOW Total Parts Cost Spent) it floors at "Left to be invoiced" whenever
  // ETC hasn't caught up to it, so this second segment can be either term
  // depending on which is larger (see projIncrement below). "Left to be
  // invoiced" is still shown — just as an informational side figure below,
  // not a segment of this bar — because it answers a real question ("how
  // much of ETC is already spoken for by an open PO") that showing only two
  // segments would otherwise drop.
  //
  // The BASE segment is Parts Actual — GL-posted spend — not `paid` (2026-08-10).
  // `paid` counts invoices flagged never to post to the general ledger, so it read
  // high against the job ledger people check this card against.
  const invoiced = financials.invoiced; // base segment — "Invoiced"
  const spent = financials.totalSpent; // Invoiced + Left to be invoiced — NOT the bar's total (see below)
  const projTotal = financials.projection; // = invoiced + max(leftToInvoice, etc) as of 2026-08-19 — the bar's own total height
  const leftToInvoiceAmount = financials.leftToInvoice; // informational only — "Left to be invoiced", included in ETC (or the floor, when ETC hasn't caught up — see below)
  // "ETC" — the bar's second (and last) segment. Deliberately the RESIDUAL
  // (projTotal - invoiced), not `financials.etc` directly (2026-08-19): since
  // the fix for job 1119 (Karl Storz), `projTotal` can be `invoiced +
  // leftToInvoice` rather than `invoiced + etc` whenever a stale/small ETC
  // hasn't caught up to an open commitment — see
  // parts-budget-projection.ts's `projectionResidual`. Reading it as a
  // residual keeps this segment's rendered HEIGHT consistent with the total
  // no matter which of the two terms actually won; reading `financials.etc`
  // directly would draw a shorter segment than the bar's own total implies
  // in exactly that case.
  const projIncrement = hasProjection ? Math.max(0, projTotal - invoiced) : 0;

  // ── Rounding that can't visibly contradict itself (audit finding) ─────────
  //
  // Two independent reconciliations now, for the two captions that each sum a
  // different pair of displayed figures:
  //   - "Total Parts Cost Spent" = Invoiced + Left to be invoiced (unchanged
  //     by the 2026-08-17 fix — still real money moved or committed).
  //   - The bar's own two segments = Invoiced + ETC, which must sum to the
  //     separately-rounded Projection total the same way.
  // Rounding each figure independently, then summing the DISPLAYED numbers,
  // doesn't always equal a total rounded on its own — e.g. 23207.616 +
  // 189298.04 = 212505.66 exactly, but round(23207.616) + round(189298.04) =
  // 212506, one dollar more than round(212505.66) = 212506... the fix is to
  // round for DISPLAY only, letting the LAST term in each sum absorb whatever
  // rounding residue is left, so both displayed subtotals always equal the
  // sum of the figures shown beside them.
  const [invoicedDisplay, leftToInvoiceDisplay] = reconcilePartsCostRounding([invoiced, leftToInvoiceAmount]);
  const totalSpentDisplay = invoicedDisplay + leftToInvoiceDisplay;
  const projTotalDisplay = Math.round(projTotal);
  const etcDisplay = hasProjection ? Math.max(0, projTotalDisplay - invoicedDisplay) : 0;

  // ── ONE shared scale for both bars (2026-08-10c, by request) ──────────────
  //
  // Budget and Bar 2 (Actual/Projection) are plotted against the SAME maximum,
  // so a taller bar always means more dollars regardless of which side it's
  // on — $1,566,916 draws visibly taller than $1,300,000. A previous version
  // scaled each bar to itself so Projection could never influence Budget's own
  // height; by request that's reverted, since the two bars ARE meant to be
  // compared by height, and the fixed-scale version made every job's Budget
  // bar look identical regardless of its actual size.
  //
  // `maxValue` and `pct` (now `sharedBarMax`/`scaleToPct`, extracted to
  // parts-cost-financials-shared.ts 2026-08-17 so the invariant below is
  // provable with real arithmetic, not just readable) are the ONLY two things
  // that decide a bar's height — there is deliberately no second, per-bar
  // scale anywhere else in this file. Reported concern: "the second bar looks
  // taller despite a lower total" — the shared domain here already makes that
  // impossible by construction (see tests/parts-cost-bar-scale.test.ts). On
  // the specific figures reported the actual gap was a real but small ~1.4%,
  // genuinely hard to eyeball at a glance — especially with a bright yellow
  // segment on top of one bar and none on the other; brighter colour reads as
  // "more" even at equal or lesser height. The pixel math itself was already
  // correct; headroom (below) is the one concrete thing that was missing.
  const maxValue = sharedBarMax(estimate ?? 0, projTotal);
  // Headroom (2026-08-17, by request: "only a small headroom for labels if
  // needed") — the value LABEL sits inside the same fixed-height frame as the
  // fill (see the frame's own comment below), packed against its bottom edge
  // alongside the fill. At a full 100% fill, the label has to render above the
  // frame's own top edge with nothing reserved for it. Capping the domain's
  // ceiling at 94% instead of 100% means even the tallest bar on the shared
  // scale leaves a consistent 6% band clear at the top for the label — the
  // SAME cap for both bars, so it changes nothing about their relative
  // heights (a value at 50% of maxValue is still exactly half the height of a
  // value at 100% of maxValue; both simply top out at 94% of BAR_H rather than
  // 100%), only where "full height" now sits inside the frame.
  const FILL_CEILING_PCT = 94;
  const pct = (v: number) => scaleToPct(v, maxValue, FILL_CEILING_PCT);
  // A percentage-of-scale as an actual PIXEL height against BAR_H — see the
  // value-label fix below for why this replaced the old `${pct}%` heights.
  const barPx = (percent: number) => (BAR_H * percent) / 100;

  // Segments bottom-to-top, each sized against the SAME shared scale as
  // Budget — Bar 2's own rendered height is the sum of these two, which
  // equals pct(projTotal) exactly, so "the bar's total height is Projection"
  // still holds. Always the actual; the ETC segment only exists (and is only
  // labelled) when there IS a projection to show — you can't state a share
  // of a figure that was never computed.
  // `value` here is the RECONCILED whole-dollar figure (see above) — what's
  // displayed beside the bar — while `heightPct` still scales off the raw,
  // full-precision figure, since the bar's geometry has no rounding-sum
  // problem to begin with (only the printed dollar labels do).
  // Which of the two competing estimates of the same future money is the larger,
  // and therefore the one the bar's top segment is actually drawn from.
  const etcIsDriving = (financials.etc ?? 0) >= leftToInvoiceAmount;

  const segments: { key: string; label: string; note?: string; value: number; color: string; heightPct: number }[] = [
    { key: "invoiced", label: "Invoiced", value: invoicedDisplay, color: BAR_INVOICED, heightPct: pct(invoiced) },
  ];
  if (hasProjection) {
    // ── "To complete", not "ETC" (2026-09-02) ────────────────────────────────
    //
    // This segment was labelled "ETC" while drawing `projIncrement` — the RESIDUAL,
    // which is the larger of ETC and Left to be invoiced (never both; adding them
    // double-counts, the 2026-08-17 fix). Those are not the same number and can
    // differ by an order of magnitude: measured on job 1131, ETC $2,000 against a
    // segment drawn at $13,018. So the legend named one figure and showed another.
    //
    // The label is not wrong in plain English — the residual genuinely is an
    // estimate to complete. It is wrong in THIS app's vocabulary, where "ETC" is a
    // proper noun: a whole tab, a specific grid figure, `financials.etc`. The bare
    // word cannot mean something that is not that number.
    //
    // "To complete" keeps the connection for anyone who knew it as ETC, without
    // claiming the word. It is also deliberately not "Remaining": that would sit
    // directly above a chip called "Left to be invoiced", two labels both meaning
    // "what's left", a dollar apart on this job — a clearer name traded for an
    // ambiguous pair.
    //
    // The label is FIXED across jobs and months; the `note` carries which of the two
    // terms is driving it. Stability in the label, accuracy in the note — the
    // alternative (a label that switches to "Left to be invoiced" when that term
    // wins) would render two near-identical legend rows with different values.
    segments.push({
      key: "etc",
      label: "To complete",
      note: etcIsDriving ? "from ETC" : "from open POs",
      value: etcDisplay,
      color: BAR_PROJECTED,
      heightPct: pct(projIncrement),
    });
  }
  // Chips read in the same top-to-bottom order the segments stack visually —
  // the topmost segment ("ETC", when present) listed first — even though
  // nothing about the compact layout below is positioned per-segment any
  // more (2026-08-12c). Keeping this order is still worth doing: it's the
  // one remaining thread connecting "which chip is this" back to "where in
  // the bar does that dollar figure live". "Left to be invoiced" is added
  // separately, after the two real segments — see the render below — since
  // it names money already inside ETC rather than a segment of its own
  // (2026-08-17 fix).
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
          (Invoiced, then ETC — 2026-08-17, was Invoiced/Left to be
          invoiced/ETC until the double-count fix, see this file's header);
          its OWN rendered height is the sum of the two, which is
          Projection's own share of the shared scale. No border on the
          fills, no reference lines, no brackets — the colour step is the
          only thing separating one segment from the next. The segment rows
          sit in a compact vertical list beside the bars (2026-08-12d),
          ordered to match the bar's top-to-bottom stacking, so no row can
          ever overlap another and nothing here can be wider than its own longest row — see that
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
              {/* The two segments stack bottom-to-top inside their own
                  sub-column (flex-col-reverse: first array item —
                  "Invoiced" — ends up at the bottom, matching before).
                  Each gets a PIXEL height (barPx), so the stack's rendered
                  height is exactly Invoiced + ETC with no
                  percentage-of-an-auto-height-parent ambiguity — it sums to
                  barPx(pct(projTotal)) exactly (2026-08-17: was Invoiced +
                  Left to be invoiced + ETC before the double-count fix — see
                  this file's header). */}
              {/* ── Each segment is its own drill target (2026-09-02) ──────
                  A <button> per segment rather than one handler on the stack with
                  hit-testing by offsetY: the segments are already separate elements,
                  so the browser's hit-testing is exact, and each gets a real
                  accessible name, focus and Enter/Space for free. A segment can be a
                  couple of pixels tall on a lopsided job, which is why the CAPTION
                  below is a target too — a 2px click target is not a way to reach
                  anything. */}
              <div className="flex w-full flex-col-reverse">
                {segments.map((s, i) =>
                  onDrill ? (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => onDrill(s.key === "etc" ? "etc" : "invoiced")}
                      aria-label={`${s.label} ${usd(s.value)} — show the detail behind this`}
                      title={`${s.label} — click for detail`}
                      className={`motion-interactive w-full flex-shrink-0 cursor-pointer ${i === segments.length - 1 ? "rounded-t-sm" : ""} ${
                        drillMode === (s.key === "etc" ? "etc" : "invoiced") ? "ring-2 ring-sdc-blue" : "hover:opacity-80"
                      }`}
                      style={{ height: barPx(s.heightPct), background: s.color }}
                    />
                  ) : (
                    <div key={s.key} className={`w-full flex-shrink-0 ${i === segments.length - 1 ? "rounded-t-sm" : ""}`} style={{ height: barPx(s.heightPct), background: s.color }} />
                  ),
                )}
              </div>
            </div>
            {/* The caption is the whole-bar target — the reliable one, since it stays
                a fixed 32px however thin the segments above it become. */}
            {onDrill ? (
              <button
                type="button"
                onClick={() => onDrill("projection")}
                aria-label="Actual / Projection — show every row behind this bar"
                title="Click for the full parts-cost detail behind this bar"
                className={`motion-interactive flex h-8 items-start justify-center rounded text-center text-note font-medium leading-tight underline decoration-dotted underline-offset-2 ${
                  drillMode === "projection" ? "text-sdc-blue-dark" : "text-sdc-gray-600 hover:text-sdc-navy"
                }`}
              >
                Actual /
                <br />
                Projection
              </button>
            ) : (
              <div className="flex h-8 items-start justify-center text-center text-note font-medium leading-tight text-sdc-gray-600">
                Actual /
                <br />
                Projection
              </div>
            )}
          </div>
        </div>

        {/* The segment rows, as one compact vertical list (2026-08-12d, by
            request — the horizontal flex-wrap version just before this
            "caused the layout to become unbalanced and stretched"). No
            absolute positioning, no `placeMarkers` collision math (both
            removed with the pinned-to-segment version this replaced), and —
            this time — no wrap cap either: `flex-col` never asks its parent
            for more than its own widest ROW, so it can't drag the card wider
            the way the flex-wrap attempt did (see SegmentMarker's own header
            for exactly how that happened). `shrink-0` still matters here for
            the same reason it does everywhere else in this card: a block
            that gets squeezed below its own content's width can only end in
            overlap, and this one's content is unbreakable dollar figures.

            "Left to be invoiced" (2026-08-17) is listed LAST and rendered
            with `informational` — it is not one of the two rows above it,
            which are the bar's own real segments; it is money already
            counted inside "ETC", shown here because "how much of ETC is
            already on an open PO" is a real, useful question even though the
            bar no longer draws it as its own stack. */}
        <div className="flex shrink-0 flex-col gap-1">
          {labelOrder.map((s) => (
            <SegmentMarker key={s.key} color={s.color} label={s.label} value={s.value} note={s.note} />
          ))}
          {onDrill ? (
            // The legend names it, so the legend is where it gets inspected — it is
            // not a segment of the bar any more (2026-08-17), so there is nothing in
            // the bar itself to click for it.
            <button
              type="button"
              onClick={() => onDrill("left")}
              aria-label={`Left to be invoiced ${usd(leftToInvoiceDisplay)} — show the rows behind this`}
              className={`motion-interactive rounded text-left ${drillMode === "left" ? "ring-1 ring-sdc-blue" : "hover:bg-sdc-blue-light/50"}`}
            >
              <SegmentMarker color={BAR_SPENT} label="Left to be invoiced" value={leftToInvoiceDisplay} note="Included in To complete" informational />
            </button>
          ) : (
            <SegmentMarker color={BAR_SPENT} label="Left to be invoiced" value={leftToInvoiceDisplay} note="Included in To complete" informational />
          )}
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
          2026-08-11 (by request): Invoiced + Left to be invoiced, `spent` —
          NOT the GL-posted-only figure this caption showed 2026-08-10 through
          2026-08-11a. That earlier choice existed because a cumulative
          committed total once read $399,177 on job 1116 against a $349,732
          ledger; the two figures summed here are the exact same two dollar
          values the legend prints (Invoiced + Left to be invoiced), so this
          reconciles with what's on screen rather than with the ledger. ETC
          is deliberately excluded — it's a forecast, not spend.
          As of 2026-08-17 (the double-count fix) this is NOT "the bar's own
          two segments" any more — the bar stacks Invoiced + ETC (=
          Projection); this caption sums Invoiced + Left to be invoiced (=
          Total Parts Cost Spent), a genuinely different pair that happens to
          share the same "Invoiced" figure. Both are still correct; they now
          answer two different questions ("spent or committed so far" vs.
          "where the job lands"), which is why the card shows both. */}
      {/* The AMOUNT carries the emphasis, not the whole line (2026-08-11f, by
          request): navy + bold + `text-sm` against the label's muted `text-note`
          makes the figure the thing the eye lands on, without turning a quiet
          caption into a second heading competing with "Projection vs Budget"
          right beneath it. The expression is untouched — still exactly
          Invoiced + Left to be invoiced. */}
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
