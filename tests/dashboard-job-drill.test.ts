import { test } from "node:test";
import assert from "node:assert/strict";
import { customerBucket } from "../src/lib/dashboard-job-drill";
import { NO_CUSTOMER, ACTIVE_JOB_WHERE, VALID_JOB_TYPES } from "../src/lib/job-filters";

// ── The bar and the table it opens must group identically ───────────────────
//
// customerBucket is the ONE expression both sides use: the Dashboard's customer
// chart groups active jobs by it, and the inline drill-through narrows its rows
// by it. These tests pin its behaviour, because the two are only guaranteed to
// agree for as long as it stays a single shared function.
//
// The bug that put it here (2026-08-28): the drill used to narrow in SQL, as
// `where: { customer: value }`. MySQL's default collation is case-insensitive,
// so 'FIRST SOLAR, INC.' also matched the rows stored as 'First Solar, Inc.' —
// a 12-job bar opened a 13-row table, and across the book the drill returned 79
// rows for 59 active jobs. Case sensitivity is therefore not a detail here; it
// is the whole point.

test("the bucket is the stored string, trimmed", () => {
  assert.equal(customerBucket("Centrus Energy"), "Centrus Energy");
  assert.equal(customerBucket("  Centrus Energy  "), "Centrus Energy");
});

test("case is PRESERVED — differently-cased customers are different buckets", () => {
  // The book really does carry all of these. The chart draws them as separate
  // bars (no fuzzy merging, by design), so the drill has to keep them separate
  // too or a bar opens somebody else's jobs.
  const variants = ["FIRST SOLAR, INC.", "First Solar, Inc.", "FIRST SOLAR INC.", "First Solar Inc."];
  const buckets = new Set(variants.map(customerBucket));
  assert.equal(buckets.size, variants.length, "two spellings collapsed into one bucket");
});

test("blank, whitespace and null all land in the one no-customer bucket", () => {
  assert.equal(customerBucket(null), NO_CUSTOMER);
  assert.equal(customerBucket(""), NO_CUSTOMER);
  assert.equal(customerBucket("   "), NO_CUSTOMER);
});

test("a real customer never lands in the no-customer bucket", () => {
  assert.notEqual(customerBucket("SDC"), NO_CUSTOMER);
});

// ── The shared active-job definition ────────────────────────────────────────

test("ACTIVE_JOB_WHERE is Active plus the valid project types", () => {
  // Both the charts and the drill spell "active" with this object. If it ever
  // gains a condition, both move together — which is the reason it exists.
  assert.equal(ACTIVE_JOB_WHERE.status, "Active");
  assert.deepEqual([...ACTIVE_JOB_WHERE.type.in], [...VALID_JOB_TYPES]);
});

test("HeadStart is NOT active — it must never appear in a drill", () => {
  // A Head Start job has no PO. It is counted in its own KPI and shown as a
  // separate row under the type chart, so folding it in here would both
  // double-count it and break the foot to the Active Jobs total.
  assert.notEqual(ACTIVE_JOB_WHERE.status, "HeadStart");
});
