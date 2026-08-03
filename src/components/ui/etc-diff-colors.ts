// The red/green "variance" colouring for the ETC grid's Diff cells.
//
// Positive (under plan) is green, negative (over plan) is red, and the SHADE now
// carries magnitude — a 4-hour variance and a 400-hour one used to be the same flat
// colour, so the column said only "off plan" and never "by how much" (2026-08-03,
// by request).
//
// ── Why inline styles and not classes ──────────────────────────────────────
// A gradient needs a computed colour, and Tailwind cannot generate one: its JIT
// scans source for literal class names, so `bg-[${c}]` compiles to nothing. Class
// buckets would work but cap the resolution at however many literals get written.
//
// Inline styles also settle a specificity problem the class version had to work
// around: the footer's own rule (`tfoot tr.etc-total-row > td`, 0-2-2) out-specifies
// a lone class, which is why the old footer colours had to be written as the full
// descendant chain in globals.css. An inline style beats every selector, so one
// function now serves both the rows and the footer.
//
// ── One rule, two places ───────────────────────────────────────────────────
// These are applied by the server render (etc/page.tsx, EtcSectionCells) AND by the
// live repaint that patches totals as a manager types (EtcLiveTotals). Until
// 2026-08-03 the repaint updated a Diff cell's number but not its colour, so a total
// crossing zero kept the colour of the value it used to hold.

// Values below this count as zero. Hour sums carry float residue (~1e-13) that would
// otherwise tint a cell that prints a plain "0".
const EPSILON = 0.005;

// The magnitude at which a cell reaches FULL saturation. Past it everything looks
// alike, which is the right message — beyond this the point is just "a lot".
//
// Deliberately different per context, because the figures are different sizes: one
// section cell's variance runs to tens of hours while a column total runs to
// hundreds, and Parts Cost is dollars. A single shared ceiling would leave every cell
// either washed out or fully saturated. Tune here — nothing else hardcodes a scale.
export const DIFF_CEILING = {
  /** One section's hours variance for one job. */
  hoursCell: 80,
  /** A rollup of hours — per-job group totals and the <tfoot> column totals. */
  hoursTotal: 400,
  /** One job's Parts Cost variance, in dollars. */
  moneyCell: 25_000,
  /** The Parts Cost grand total, in dollars. */
  moneyTotal: 250_000,
} as const;

// Square-rooted rather than linear: most variances sit near the bottom of the range,
// and a linear ramp makes everything under ~15% of the ceiling look identically pale.
// The sqrt lifts small values into visibility while still ranking the large ones.
function intensity(diff: number, ceiling: number): number {
  return Math.sqrt(Math.min(1, Math.abs(diff) / ceiling));
}

type Rgb = readonly [number, number, number];

function mix(from: Rgb, to: Rgb, t: number): string {
  const c = (i: number) => Math.round(from[i] + (to[i] - from[i]) * t);
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
}

// Body-row backgrounds. The pale ends are barely-there tints, so a small variance
// reads as "slightly off" rather than as an alarm; the strong ends are dark enough to
// need white text, handled below.
const CELL_GREEN: readonly [Rgb, Rgb] = [
  [233, 245, 224],
  [58, 124, 29],
];
const CELL_RED: readonly [Rgb, Rgb] = [
  [253, 234, 232],
  [168, 32, 22],
];

// Above this intensity the background is too dark for the cell's default dark text.
const WHITE_TEXT_ABOVE = 0.62;

/**
 * Background colouring for a Diff cell in the table BODY. Returns an empty object for
 * a zero (or absent) variance, so the cell keeps the background it already has — its
 * zebra stripe or row highlight — instead of being forced to white.
 */
export function diffCellStyle(diff: number | null, ceiling: number): { backgroundColor?: string; color?: string } {
  if (diff == null || Math.abs(diff) < EPSILON) return {};
  const t = intensity(diff, ceiling);
  const [pale, strong] = diff < 0 ? CELL_RED : CELL_GREEN;
  const style: { backgroundColor?: string; color?: string } = { backgroundColor: mix(pale, strong, t) };
  if (t > WHITE_TEXT_ABOVE) style.color = "#ffffff";
  return style;
}

// The <tfoot> Total row is a dark steel blue, so down there the variance reads as
// TEXT. On a dark fill "stronger" means brighter and more saturated — the opposite
// direction to the body — hence a separate pair rather than reusing the backgrounds,
// which would be near-invisible at their pale end.
const TOTAL_GREEN: readonly [Rgb, Rgb] = [
  [168, 206, 140],
  [126, 239, 102],
];
const TOTAL_RED: readonly [Rgb, Rgb] = [
  [240, 170, 166],
  [255, 110, 96],
];

/**
 * Text colouring for a Diff cell in the <tfoot> Total row. Returns an empty object at
 * zero so the cell inherits the footer's normal pale blue — the same "no news"
 * treatment the flat version gave it.
 */
export function diffTotalStyle(diff: number | null, ceiling: number): { color?: string; fontWeight?: number } {
  if (diff == null || Math.abs(diff) < EPSILON) return {};
  const t = intensity(diff, ceiling);
  const [faint, vivid] = diff < 0 ? TOTAL_RED : TOTAL_GREEN;
  return { color: mix(faint, vivid, t), fontWeight: 700 };
}
