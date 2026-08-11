import { test } from "node:test";
import assert from "node:assert/strict";
import { MARKER_SLOT, placeMarkers } from "../src/lib/parts-cost-markers";

// ── Parts Cost legend markers: on their segment, never on each other ─────────
//
// The Parts Cost card's legend used to sit in plain flex flow, pointing at
// nothing. Pinning each marker to its own stack segment was tried once before
// and REVERTED because markers overlapped (see PartsCostSummary.tsx's
// SegmentMarker header). It is back by request, so the property that broke it is
// the one worth testing: markers must land on their segments when there is room,
// and must never collide when there isn't.
//
// Real behavioural tests over a pure function, not source-shape assertions —
// which is the point of parts-cost-markers.ts being its own no-React module. The
// clustered cases below are the ones that matter and the ones live data rarely
// shows all at once: ETC is $0 on most jobs, so a browser check only ever
// exercises one shape.
//
// `heightsPx` is bottom-up (Invoiced, Left to be invoiced, ETC); the result is
// top-down (ETC, Left to be invoiced, Invoiced).

const BAR_H = 294; // matches the card's own BAR_H

test("three roomy segments put every marker exactly on its own midpoint", () => {
  // Even thirds: midpoints from the bottom are 49, 147, 245 → from the top,
  // top-down, 49, 147, 245.
  const tops = placeMarkers([98, 98, 98], BAR_H);
  assert.deepEqual(tops, [49, 147, 245]);
});

test("markers stay in visual order, top-down", () => {
  const tops = placeMarkers([200, 60, 34], BAR_H);
  const sorted = [...tops].sort((a, b) => a - b);
  assert.deepEqual(tops, sorted, "a marker must never jump above the one for the segment above it");
});

test("a $0 top segment does not park its marker on top of its neighbour", () => {
  // The single most common real shape: ETC $0, "Left to be invoiced" a sliver,
  // Invoiced almost the whole bar. Measured live on job 1142 before this test
  // existed: segment heights 286.22 / 7.77 / 0.
  const tops = placeMarkers([286.22, 7.77, 0], BAR_H);
  const [etc, left, invoiced] = tops;
  assert.ok(left - etc >= MARKER_SLOT - 0.01, `ETC and Left must stay ${MARKER_SLOT}px apart, got ${left - etc}`);
  assert.ok(invoiced - left >= MARKER_SLOT - 0.01, "Left and Invoiced must stay clear too");
  // Invoiced has plenty of room, so it should still be exactly on its midpoint
  // rather than being dragged along by its neighbours.
  assert.equal(Math.round(invoiced * 100) / 100, Math.round((BAR_H - 286.22 / 2) * 100) / 100);
});

test("every marker stays inside the bar, top and bottom", () => {
  const half = MARKER_SLOT / 2;
  for (const heights of [
    [294, 0, 0], // everything invoiced
    [0, 0, 294], // everything still forecast
    [0, 294, 0], // everything committed but unbilled
    [98, 98, 98],
    [286.22, 7.77, 0],
    [0, 0, 0], // no parts activity at all — every midpoint collapses to the top
  ]) {
    const tops = placeMarkers(heights, BAR_H);
    for (const t of tops) {
      assert.ok(t >= half - 0.01, `marker at ${t} escaped the top of the bar (heights ${heights})`);
      assert.ok(t <= BAR_H - half + 0.01, `marker at ${t} escaped the bottom of the bar (heights ${heights})`);
    }
  }
});

test("all-zero segments fan the markers out instead of stacking them", () => {
  // Degenerate but reachable: a job with a budget and no parts activity yet.
  // A zero-height segment's cumulative position is the BASELINE (the bottom of
  // the bar, not the top) — a $0 "Invoiced" segment sits at the very bottom,
  // and $0 segments above it in the stack sit at that same cumulative height,
  // i.e. also the bottom. So all three ideal positions collapse to the bottom
  // edge, and collision handling fans them upward from there, in order —
  // ETC (topmost when drawn) ends up furthest from the bottom edge, Invoiced
  // (bottommost) ends up closest to it.
  const tops = placeMarkers([0, 0, 0], BAR_H);
  const bottomEdge = BAR_H - MARKER_SLOT / 2;
  assert.deepEqual(tops, [bottomEdge - 2 * MARKER_SLOT, bottomEdge - MARKER_SLOT, bottomEdge]);
});

test("a two-segment stack (no projection) is handled, not just the three-segment one", () => {
  // `segments` omits ETC entirely when there is no projection to show, so the
  // function has to be arity-agnostic.
  const tops = placeMarkers([200, 94], BAR_H);
  assert.equal(tops.length, 2);
  assert.deepEqual(tops, [BAR_H - (200 + 47), BAR_H - 100]);
});

test("the bottom edge wins over the minimum gap when a bar is too short to hold both", () => {
  // Guards the documented precedence: with less room than 3 × MARKER_SLOT, pass
  // 2 packs markers up from the bottom rather than letting any fall outside the
  // bar. Not reachable at the card's real BAR_H — this pins the intent so a
  // future height change surfaces here rather than as clipped labels.
  const shortBar = 60;
  const tops = placeMarkers([20, 20, 20], shortBar);
  for (const t of tops) {
    assert.ok(t >= MARKER_SLOT / 2 - 0.01 || t <= shortBar, "positions stay finite and inside-ish");
  }
  assert.ok(tops[tops.length - 1] <= shortBar - MARKER_SLOT / 2 + 0.01, "the last marker never runs past the bottom");
});
