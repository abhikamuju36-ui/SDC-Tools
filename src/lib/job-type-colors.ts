import { VALID_JOB_TYPES } from "@/lib/job-filters";

// ── One colour per project type (2026-08-28) ────────────────────────────────
//
// The Dashboard draws project type in two places that must agree: the ranked
// "Active Jobs by Project Type" bars, and the per-type segments stacked inside
// each customer's bar in "Active Jobs by Customer". A reader compares a segment
// against a bar across the two charts, so a type has to be the same colour in
// both — hence one map here rather than a palette in each component.
//
// Keyed off VALID_JOB_TYPES (job-filters.ts) rather than a hand-listed set, and
// the test asserts every valid type has an entry: adding a sixth type must not
// silently render as the fallback grey in one chart and something else in the
// other.
//
// These are the app's own brand tokens, not new hexes. Deliberately NOT a
// status/severity palette: sdc-red and the yellow/green pair carry "late",
// "risk" and "on track" elsewhere on this page, so red is left out entirely and
// the two that remain are paired with types that carry no such reading. Type is
// an identity, not a judgement, and a Duplicate job is not "worse" than a
// Custom one.

export type JobTypeColor = {
  /** Bar / segment fill. */
  bar: string;
  /** Legend swatch — same colour, kept separate so a future muted legend is one edit. */
  swatch: string;
};

const FALLBACK: JobTypeColor = { bar: "bg-sdc-gray-400", swatch: "bg-sdc-gray-400" };

const BY_TYPE: Record<string, JobTypeColor> = {
  Custom: { bar: "bg-sdc-blue", swatch: "bg-sdc-blue" },
  Duplicate: { bar: "bg-sdc-purple", swatch: "bg-sdc-purple" },
  Hybrid: { bar: "bg-sdc-green", swatch: "bg-sdc-green" },
  Service: { bar: "bg-sdc-yellow", swatch: "bg-sdc-yellow" },
  "T&M": { bar: "bg-sdc-navy", swatch: "bg-sdc-navy" },
};

/** Never throws and never returns undefined — an unmapped type renders grey rather than invisible. */
export function jobTypeColor(type: string): JobTypeColor {
  return BY_TYPE[type] ?? FALLBACK;
}

/** Canonical legend order — the declared type order, not whatever a given month ranked. */
export const JOB_TYPE_LEGEND: readonly string[] = VALID_JOB_TYPES;

/**
 * Ranked order for a bar chart: count descending, then the canonical type order
 * as a stable tiebreak so two equal counts don't swap places between renders.
 *
 * Zero-count types sort to the end rather than being dropped — the charts
 * de-emphasise them instead of hiding them, so "we have no Service work right
 * now" stays visible as a fact rather than becoming an absence the reader has to
 * notice. Callers that genuinely want them gone can filter after sorting.
 */
export function rankByCount<T extends { type: string; count: number }>(rows: readonly T[]): T[] {
  const canonical = new Map(VALID_JOB_TYPES.map((t, i) => [t as string, i]));
  return [...rows].sort(
    (a, b) =>
      b.count - a.count ||
      (canonical.get(a.type) ?? Number.MAX_SAFE_INTEGER) - (canonical.get(b.type) ?? Number.MAX_SAFE_INTEGER) ||
      a.type.localeCompare(b.type),
  );
}
