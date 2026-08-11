// ── Where the Parts Cost legend markers sit ─────────────────────────────────
//
// Pure, no React and no DOM — the same reason table-sort.ts, hours-filters.ts
// and job-bom-rules.ts are their own modules: the interesting behaviour here is
// the collision handling, and that deserves a real unit test rather than being
// verified only against whichever job happened to be on screen.
//
// Used by components/PartsCostSummary.tsx to pin each legend marker beside the
// stack segment it names.

/**
 * Vertical space one marker occupies: two `text-xs leading-snug` lines
 * (≈15.5px each at this app's 15px root — label, then value) plus a little
 * breathing room.
 *
 * This is only a reliable reservation because SegmentMarker sets
 * `whitespace-nowrap`, so a marker is ALWAYS exactly two lines tall. That
 * matters: the previous attempt at pinning these markers was reverted because
 * labels wrapped to an unpredictable height and overlapped. See that
 * component's header for the full history.
 */
export const MARKER_SLOT = 34; // px

/**
 * Vertical centre (px from the top of the bar box) for each legend marker,
 * given the stack's segment heights in px.
 *
 * `heightsPx` is BOTTOM-UP (the order the segments are stacked and drawn); the
 * returned array is TOP-DOWN, matching the order the markers are rendered in.
 *
 * Each marker wants its own segment's midpoint. Two passes stop that from ever
 * producing an overlap:
 *
 *   1. top-down — never let a marker sit closer than MARKER_SLOT to the one
 *      above it, nor above the top edge (pushing down);
 *   2. bottom-up — never let one run past the bottom edge (pulling back up),
 *      which is what pass 1 can cause when segments bunch together.
 *
 * This matters far more on real data than it sounds: ETC is frequently $0 and
 * "Left to be invoiced" is often a sliver, so two or three midpoints can land
 * within a pixel of each other at the top of the bar. Their markers then fan
 * out from that point in the right order instead of stacking on top of one
 * another, while every marker that has room stays exactly on its segment.
 *
 * With more markers than the bar can hold at MARKER_SLOT spacing, pass 2 wins
 * and they pack from the bottom — overlapping is preferred to falling outside
 * the bar entirely, but that needs a bar under ~102px for the current three
 * markers, which the card's own BAR_H rules out.
 */
export function placeMarkers(heightsPx: number[], barH: number): number[] {
  // Midpoint of each segment, measured from the BOTTOM (segments are bottom-up).
  const midFromBottom: number[] = [];
  let stacked = 0;
  for (const h of heightsPx) {
    midFromBottom.push(stacked + h / 2);
    stacked += h;
  }
  // Flip to "from the top", and to top-down order, so both passes below read in
  // the same direction the markers are rendered.
  const ideal = midFromBottom.map((m) => barH - m).reverse();

  const half = MARKER_SLOT / 2;
  const out = [...ideal];
  // Pass 1 — push down off the top edge and off each other.
  let floor = half;
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.max(out[i], floor);
    floor = out[i] + MARKER_SLOT;
  }
  // Pass 2 — pull back up off the bottom edge, preserving the same gap.
  let ceiling = barH - half;
  for (let i = out.length - 1; i >= 0; i--) {
    out[i] = Math.min(out[i], ceiling);
    ceiling = out[i] - MARKER_SLOT;
  }
  return out;
}
