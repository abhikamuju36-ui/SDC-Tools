import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { invoicedOnly } from "../src/lib/sync-totaleto";
import type { JobPartsCost, PartsCostLine } from "../src/lib/sync-totaleto";

// ── Parts Spent drill-through: invoiced lines only (§77) ────────────────────
//
// The second-level "purchase lines" panel behind a job row in the Monthly ETC Parts
// Spent drill used to show a job's WHOLE purchase history — ordered-but-unbilled parts
// included. By request, it now shows only lines that have actually been invoiced:
// `Invoiced Amount > 0`. `invoicedOnly` is the pure function that does it, kept separate
// from getJobPartsCost (the live TotalETO query — needs a real connection, proven
// instead by scripts/parts-spent-recon.ts) so this arithmetic is testable without one.

function line(over: Partial<PartsCostLine>): PartsCostLine {
  return {
    purchaseDate: "2026-01-01",
    invoicedDate: null,
    supplier: "Acme",
    manufacturer: "Acme",
    category: null,
    poNumber: "101",
    partNumber: "P-1",
    description: "A part",
    quantity: 1,
    unitPrice: 100,
    totalPrice: 100,
    invoicedAmount: 0,
    ...over,
  };
}

// ── The filter itself ────────────────────────────────────────────────────────

test("a line with nothing invoiced is dropped", () => {
  const full: JobPartsCost = { purchased: 100, paid: 0, leftToPay: 100, lines: [line({ invoicedAmount: 0 })] };
  const out = invoicedOnly(full);
  assert.deepEqual(out.lines, []);
});

test("a line with a real invoiced amount is kept", () => {
  const invoiced = line({ totalPrice: 100, invoicedAmount: 100 });
  const full: JobPartsCost = { purchased: 100, paid: 100, leftToPay: 0, lines: [invoiced] };
  const out = invoicedOnly(full);
  assert.deepEqual(out.lines, [invoiced]);
});

test("the requirement is strictly greater than zero — a credit note is dropped too", () => {
  // §77's own wording: "Show only rows with Invoiced Amount > 0." A negative
  // invoicedAmount (a credit/refund against a PO) is not zero, but it is also not
  // positive, and the acceptance criteria do not carve out an exception for it.
  const credit = line({ invoicedAmount: -50 });
  const out = invoicedOnly({ purchased: 0, paid: -50, leftToPay: 50, lines: [credit] });
  assert.deepEqual(out.lines, []);
});

test("mixed lines: only the invoiced ones survive, in their original order", () => {
  const uninvoiced = line({ poNumber: "1", invoicedAmount: 0 });
  const invoicedA = line({ poNumber: "2", totalPrice: 200, invoicedAmount: 200 });
  const partial = line({ poNumber: "3", totalPrice: 500, invoicedAmount: 300 });
  const full: JobPartsCost = {
    purchased: 800,
    paid: 500,
    leftToPay: 300,
    lines: [uninvoiced, invoicedA, partial],
  };
  const out = invoicedOnly(full);
  assert.deepEqual(
    out.lines.map((l) => l.poNumber),
    ["2", "3"],
    "the surviving lines keep getJobPartsCost's own sort (newest-purchase-first) — this function must not re-sort",
  );
});

// ── The totals are the sum of what is actually returned ─────────────────────

test("purchased/paid/leftToPay are recomputed from the KEPT lines, not sliced from the input", () => {
  // The input's OWN totals (100 uninvoiced + 200 invoiced = 300 purchased, 200 paid) must
  // not leak through — once the uninvoiced line is dropped, "purchased" has to shrink
  // with it, or the drill would state a total the visible rows do not add up to.
  const uninvoiced = line({ totalPrice: 100, invoicedAmount: 0 });
  const invoiced = line({ totalPrice: 200, invoicedAmount: 200 });
  const full: JobPartsCost = { purchased: 300, paid: 200, leftToPay: 100, lines: [uninvoiced, invoiced] };
  const out = invoicedOnly(full);
  assert.equal(out.purchased, 200, "purchased must be the sum of the SURVIVING lines' totalPrice");
  assert.equal(out.paid, 200);
  assert.equal(out.leftToPay, 0);
});

test("a partially-invoiced line still contributes its own leftToPay", () => {
  // Kept (invoicedAmount > 0), but totalPrice and invoicedAmount differ — the line
  // itself still has money left to pay, and that must survive into the recomputed total.
  const partial = line({ totalPrice: 500, invoicedAmount: 300 });
  const out = invoicedOnly({ purchased: 500, paid: 300, leftToPay: 200, lines: [partial] });
  assert.equal(out.purchased, 500);
  assert.equal(out.paid, 300);
  assert.equal(out.leftToPay, 200);
});

test("an empty input stays empty, with zeroed totals rather than NaN", () => {
  const out = invoicedOnly({ purchased: 0, paid: 0, leftToPay: 0, lines: [] });
  assert.deepEqual(out, { purchased: 0, paid: 0, leftToPay: 0, lines: [] });
});

// ── Isolation: the shared query stays untouched for other views ─────────────

const SRC = join(import.meta.dirname, "..", "src");
function code(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/[^\n]*$/gm, "")
    .replace(/\/\/[^\n"'`]*$/gm, "");
}

// Slices from a function's `export async function NAME` declaration to the start of
// whatever comes next (another top-level export, or end of file) — robust to the
// function being last in the file, where a search for a specific closing-brace pattern
// can run past the end and return an empty slice.
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} must exist in the source`);
  const nextExport = source.indexOf("\nexport ", start + 1);
  return nextExport === -1 ? source.slice(start) : source.slice(start, nextExport);
}

test("getJobPartsCost itself is never filtered — other pages still need every line", () => {
  // job-hours/page.tsx (Job Hour Details / Procurement) calls getJobPartsCost directly,
  // not the drill's action, and it must keep seeing ordered-but-unbilled parts — that is
  // exactly what a procurement reader opens the page to find. invoicedOnly must be
  // applied AFTER getJobPartsCost returns, never folded into the function itself or its
  // SQL, or every other consumer would silently lose those rows too.
  const fnBody = functionBody(code("lib", "sync-totaleto.ts"), "getJobPartsCost");
  assert.doesNotMatch(fnBody, /invoicedAmount > 0/, "getJobPartsCost must return every line, invoiced or not");
});

test("only loadJobPartsLines — the Parts Spent drill's own action — applies the filter", () => {
  const ACTIONS = code("lib", "hours-detail-actions.ts");
  const fnBody = functionBody(ACTIONS, "loadJobPartsLines");
  assert.match(fnBody, /invoicedOnly\(/, "the drill's action must apply the filter");

  // And nothing else in the same file (loadEtcMonthHoursDetail, loadPartsSpentDetail —
  // the punch drill and the job-level rows) reaches for it; neither of those is about
  // individual purchase lines at all. The import line itself names `invoicedOnly` too,
  // so the check is for a CALL, not the bare identifier.
  const others = ACTIONS.replace(fnBody, "");
  assert.doesNotMatch(others, /invoicedOnly\(/, "no other action in this file should call the filter");
});
