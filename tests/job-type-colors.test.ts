import { test } from "node:test";
import assert from "node:assert/strict";
import { jobTypeColor, JOB_TYPE_LEGEND, rankByCount } from "../src/lib/job-type-colors";
import { VALID_JOB_TYPES } from "../src/lib/job-filters";

// The Dashboard draws project type in two charts — the ranked type bars and the
// per-type segments inside each customer bar — and a reader compares a segment
// against a bar across them. So the colour map has to cover every valid type,
// and the ranking has to be deterministic.

test("every valid job type has its own colour", () => {
  for (const t of VALID_JOB_TYPES) {
    const c = jobTypeColor(t);
    assert.ok(c.bar.startsWith("bg-"), `${t} has no bar colour`);
    assert.notEqual(c.bar, "bg-sdc-gray-400", `${t} fell through to the unmapped fallback`);
  }
});

test("no two types share a colour — a stacked bar has to be readable", () => {
  const seen = new Map<string, string>();
  for (const t of VALID_JOB_TYPES) {
    const bar = jobTypeColor(t).bar;
    const prior = seen.get(bar);
    assert.equal(prior, undefined, `${t} and ${prior} both render ${bar}`);
    seen.set(bar, t);
  }
});

test("an unknown type renders grey rather than disappearing", () => {
  // A type added to the database but not to the map must still draw something —
  // an invisible segment would silently break the "segments sum to the bar" rule.
  assert.equal(jobTypeColor("Wildcard").bar, "bg-sdc-gray-400");
});

test("the legend is the canonical type order, not a ranked one", () => {
  assert.deepEqual([...JOB_TYPE_LEGEND], [...VALID_JOB_TYPES]);
});

test("rankByCount sorts by count descending", () => {
  const ranked = rankByCount([
    { type: "Custom", count: 3 },
    { type: "Duplicate", count: 9 },
    { type: "T&M", count: 5 },
  ]);
  assert.deepEqual(ranked.map((r) => r.type), ["Duplicate", "T&M", "Custom"]);
});

test("equal counts fall back to the canonical order, so bars cannot swap between renders", () => {
  // Two types on the same count must not depend on input order — the chart would
  // reshuffle itself on every re-render.
  const a = rankByCount([
    { type: "T&M", count: 4 },
    { type: "Custom", count: 4 },
  ]);
  const b = rankByCount([
    { type: "Custom", count: 4 },
    { type: "T&M", count: 4 },
  ]);
  assert.deepEqual(a.map((r) => r.type), b.map((r) => r.type));
  // Custom is declared before T&M in VALID_JOB_TYPES, so it wins the tie.
  assert.deepEqual(a.map((r) => r.type), ["Custom", "T&M"]);
});

test("zero-count types sort last but are NOT dropped", () => {
  const ranked = rankByCount([
    { type: "Service", count: 0 },
    { type: "Custom", count: 2 },
    { type: "Hybrid", count: 0 },
  ]);
  assert.equal(ranked.length, 3, "a zero-count type was dropped — the charts de-emphasise, they do not hide");
  assert.equal(ranked[0].type, "Custom");
  assert.deepEqual(ranked.slice(1).map((r) => r.type), ["Hybrid", "Service"]);
});

test("rankByCount does not mutate its input", () => {
  const input = [
    { type: "Custom", count: 1 },
    { type: "Duplicate", count: 7 },
  ];
  const before = input.map((r) => r.type);
  rankByCount(input);
  assert.deepEqual(input.map((r) => r.type), before);
});
