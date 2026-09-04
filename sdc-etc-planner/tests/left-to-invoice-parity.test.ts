import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  monthEndCutoff,
  dayOf,
  isWithinAsOf,
  lineLeftToInvoice,
  leftToInvoiceForLines,
  rawLeftToInvoice,
  explainLeftToInvoice,
  monthEndLabel,
  shownLeftToInvoice,
  shownLeftToInvoiceSource,
} from "../src/lib/left-to-invoice";
import type { PartsCostLine } from "../src/lib/sync-totaleto";

// ── Monthly ETC's Left to Invoice must BE the Parts List's ───────────────────
//
// Reported 2026-09-03. Measured over August 2026's 49 Parts Cost jobs
// (scripts/audit-left-to-invoice-parity.ts): Monthly ETC $2,238,624.84 against the
// Parts List's $2,137,726.85 through 08/31 — $100,376.71 of it POs placed on
// September 1st–3rd, counted as August exposure because Monthly ETC had no cutoff
// at all, plus $521.28 of aggregate flooring.
//
// The rule these tests hold to:
//
//     leftToInvoice(job, month M) === leftToInvoice(job, asOf = last day of M)
//
// It is one function now, so parity is not a coincidence to be re-checked — but the
// FIXTURES below are what make that meaningful, because they carry every case the
// report asked about (partial invoices, credits, zero rows, undated lines, month
// boundaries, over-invoicing) rather than only the happy path.

const line = (o: Partial<PartsCostLine>): PartsCostLine => ({
  purchaseDate: null,
  invoicedDate: null,
  supplier: null,
  manufacturer: null,
  category: null,
  poNumber: null,
  partNumber: null,
  description: null,
  quantity: 1,
  unitPrice: 0,
  totalPrice: 0,
  invoicedAmount: 0,
  actualAmount: 0,
  ...o,
});

// Three jobs, each carrying a different edge case, plus the August/September
// boundary that produced the reported gap.
const JOBS: Record<string, PartsCostLine[]> = {
  // Straightforward: one fully invoiced line, one open, one part-invoiced.
  "1130": [
    line({ poNumber: "A1", partNumber: "P-1", purchaseDate: "2026-07-14T00:00:00.000Z", invoicedDate: "2026-07-20T00:00:00.000Z", totalPrice: 1000, invoicedAmount: 1000, actualAmount: 1000 }),
    line({ poNumber: "A2", partNumber: "P-2", purchaseDate: "2026-08-03T00:00:00.000Z", totalPrice: 2500, invoicedAmount: 0, actualAmount: 0 }),
    line({ poNumber: "A3", partNumber: "P-3", purchaseDate: "2026-08-19T00:00:00.000Z", invoicedDate: "2026-08-28T00:00:00.000Z", totalPrice: 800, invoicedAmount: 300, actualAmount: 300 }),
    // The reported leak: a September PO on a page closing August.
    line({ poNumber: "A4", partNumber: "P-4", purchaseDate: "2026-09-02T00:00:00.000Z", totalPrice: 4016.07, invoicedAmount: 0, actualAmount: 0 }),
  ],
  // A credit, and a line billed but not GL-posted — the two places a naive
  // implementation picks the wrong field or clamps the wrong thing.
  "1134": [
    line({ poNumber: "B1", partNumber: "Q-1", purchaseDate: "2026-08-05T00:00:00.000Z", invoicedDate: "2026-08-11T00:00:00.000Z", totalPrice: 500, invoicedAmount: 500, actualAmount: 500 }),
    line({ poNumber: "B2", partNumber: "Q-2", purchaseDate: "2026-08-06T00:00:00.000Z", invoicedDate: "2026-08-12T00:00:00.000Z", totalPrice: -427.54, invoicedAmount: 0, actualAmount: 0 }),
    // Billed $900 but only $200 posted to the GL. actualAmount is the field.
    line({ poNumber: "B3", partNumber: "Q-3", purchaseDate: "2026-08-07T00:00:00.000Z", invoicedDate: "2026-08-30T00:00:00.000Z", totalPrice: 900, invoicedAmount: 900, actualAmount: 200 }),
  ],
  // An undated line, and a line whose posting lands after month end.
  "1162": [
    line({ poNumber: "C1", partNumber: "R-1", purchaseDate: null, totalPrice: 344, invoicedAmount: 0, actualAmount: 0 }),
    line({ poNumber: "C2", partNumber: "R-2", purchaseDate: "2026-08-31T00:00:00.000Z", totalPrice: 2561.22, invoicedAmount: 0, actualAmount: 0 }),
    line({ poNumber: "C3", partNumber: "R-3", purchaseDate: "2026-08-20T00:00:00.000Z", invoicedDate: "2026-09-04T00:00:00.000Z", totalPrice: 5000, invoicedAmount: 5000, actualAmount: 5000 }),
    line({ poNumber: "C4", partNumber: "R-4", purchaseDate: "2026-09-01T00:00:00.000Z", totalPrice: 61499.68, invoicedAmount: 0, actualAmount: 0 }),
  ],
};

/** Money compared to the cent — see the note in the asOfPosting test. */
const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * The Parts List's own arithmetic, written out independently here.
 *
 * Deliberately NOT importing the shared function: a parity test that calls the same
 * code on both sides proves only that a function equals itself. This is the Parts
 * List's rule as the component applies it — filter rows by the purchase-date bound
 * the way JobProcurement's predicate does, then sum the per-row signed column the
 * way PartsTableView's footer does.
 */
const partsListLeftToInvoice = (lines: PartsCostLine[], to: string | null): number => {
  let total = 0;
  for (const l of lines) {
    const d = l.purchaseDate ? l.purchaseDate.slice(0, 10) : null;
    if (to && d !== null && d > to) continue; // the component's `day > to` exclusion
    total += l.totalPrice - l.actualAmount; // the component's leftToSpend column
  }
  return total;
};

test("month end is the inclusive last day, leap years included", () => {
  assert.equal(monthEndCutoff("2026-08"), "2026-08-31");
  assert.equal(monthEndCutoff("2026-09"), "2026-09-30");
  assert.equal(monthEndCutoff("2026-02"), "2026-02-28");
  assert.equal(monthEndCutoff("2024-02"), "2024-02-29", "leap year");
  assert.equal(monthEndCutoff("2026-12"), "2026-12-31");
  // Unparseable degrades to "no cutoff" — the lifetime figure this used to be —
  // rather than to a cutoff that excludes everything.
  for (const bad of ["", "2026", "2026-13", "2026-00", "August", null, undefined]) {
    assert.equal(monthEndCutoff(bad), null, `${bad} must not produce a cutoff`);
  }
});

test("dates are compared as strings — no Date, no timezone", () => {
  // The whole timezone question is answered by never constructing a Date. Parsing
  // "2026-08-31T00:00:00.000Z" on a UTC-5 server gives August 30th locally, which
  // would move a purchase out of the month that paid for it.
  assert.equal(dayOf("2026-08-31T00:00:00.000Z"), "2026-08-31");
  assert.equal(dayOf("2026-08-31"), "2026-08-31");
  assert.equal(dayOf(null), null);
  assert.equal(dayOf(""), null);
  assert.equal(dayOf("not-a-date"), null);
  // Structural: the file may construct a Date exactly once, and only from NUMBERS —
  // `new Date(y, m, 0)`, the day-count trick in monthEndCutoff. Any `new Date(<string>)`
  // is the timezone bug walking back in.
  const code = readFileSync(join(process.cwd(), "src", "lib", "left-to-invoice.ts"), "utf8")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const constructions = code.match(/new Date\([^)]*\)/g) ?? [];
  // Both permitted constructions take NUMBERS: the month-length trick in
  // monthEndCutoff, and monthEndLabel's formatting-only date. Neither parses a string,
  // which is the whole timezone question. `new Date(<string>)` anywhere here is the bug
  // walking back in.
  assert.deepEqual(
    [...new Set(constructions)].sort(),
    ["new Date(y, m - 1, d)", "new Date(y, m, 0)"],
    "every Date must be built from numbers, never parsed from a string",
  );
});

test("the end date is inclusive — the 31st belongs to August", () => {
  const l = line({ purchaseDate: "2026-08-31T18:45:00.000Z", totalPrice: 100 });
  assert.equal(isWithinAsOf(l, "2026-08-31"), true, "same day, later clock time, still in");
  assert.equal(isWithinAsOf(line({ purchaseDate: "2026-09-01T00:00:00.000Z" }), "2026-08-31"), false);
  assert.equal(isWithinAsOf(l, null), true, "no cutoff includes everything");
});

test("an undated line is a commitment, not a row to drop", () => {
  // The Parts List's table filter drops undated rows (`if (!d) return false`) because
  // it cannot place them in a range. A TOTAL must not: an undated commitment is still
  // owed. Measured $0.00 in August, which is a reason to keep it correct rather than
  // a reason to skip it.
  const undated = line({ purchaseDate: null, totalPrice: 344 });
  assert.equal(isWithinAsOf(undated, "2026-08-31"), true);
  assert.equal(leftToInvoiceForLines([undated], { asOf: "2026-08-31" }), 344);
});

test("GL-posted actual is the field, never the billed amount", () => {
  // $900 billed, $200 posted. Using invoicedAmount would report $0 left on a line
  // that still owes $700. Worth $378,989.26 across August if the two ever diverged.
  const l = line({ totalPrice: 900, invoicedAmount: 900, actualAmount: 200 });
  assert.equal(lineLeftToInvoice(l), 700);
});

test("a credit nets against its neighbours; only the total is floored", () => {
  const credit = line({ purchaseDate: "2026-08-06", totalPrice: -427.54 });
  const normal = line({ purchaseDate: "2026-08-05", totalPrice: 500, actualAmount: 500 });
  // Per line: signed, so the Parts List column can show the credit as a negative.
  assert.equal(lineLeftToInvoice(credit), -427.54);
  // In aggregate: the credit reduces the pair rather than being clamped away alone.
  assert.equal(rawLeftToInvoice([normal, credit]), -427.54);
  assert.equal(leftToInvoiceForLines([normal, credit]), 0, "a job cannot owe negative money");
  // And it nets properly when there is something to net against.
  const open = line({ purchaseDate: "2026-08-07", totalPrice: 1000 });
  assert.equal(leftToInvoiceForLines([open, credit]), 572.46);
});

test("a fully invoiced line contributes nothing, a zero row changes nothing", () => {
  assert.equal(lineLeftToInvoice(line({ totalPrice: 1000, invoicedAmount: 1000, actualAmount: 1000 })), 0);
  assert.equal(lineLeftToInvoice(line({})), 0);
  assert.equal(leftToInvoiceForLines([]), 0, "no lines is a real $0, not NaN");
});

test("PARITY: Monthly ETC for month M equals the Parts List through the last day of M", () => {
  // The headline requirement, per job and in total, over fixtures carrying every
  // edge case above. The right-hand side is the independent re-implementation.
  const asOf = monthEndCutoff("2026-08");
  let etcTotal = 0;
  let listTotal = 0;
  for (const [job, lines] of Object.entries(JOBS)) {
    const etc = rawLeftToInvoice(lines, { asOf });
    const list = partsListLeftToInvoice(lines, asOf);
    assert.equal(etc, list, `job ${job}: Monthly ETC ${etc} vs Parts List ${list} through ${asOf}`);
    etcTotal += etc;
    listTotal += list;
  }
  assert.equal(etcTotal, listTotal, "and in total across every job");

  // Concretely, so the numbers are readable rather than merely equal:
  //   1130  2500 + (800-300) = 3000, September's 4016.07 excluded
  //   1134  0 + (-427.54) + (900-200) = 272.46
  //   1162  344 + 2561.22 + 0 = 2905.22, September's 61499.68 excluded
  assert.equal(rawLeftToInvoice(JOBS["1130"], { asOf }), 3000);
  assert.equal(rawLeftToInvoice(JOBS["1134"], { asOf }), 272.46);
  assert.equal(cents(rawLeftToInvoice(JOBS["1162"], { asOf })), 2905.22);
});

test("PARITY holds for every month, not just the one that was reported", () => {
  for (const month of ["2026-06", "2026-07", "2026-08", "2026-09", "2026-12", "2024-02"]) {
    const asOf = monthEndCutoff(month);
    for (const [job, lines] of Object.entries(JOBS)) {
      assert.equal(
        rawLeftToInvoice(lines, { asOf }),
        partsListLeftToInvoice(lines, asOf),
        `job ${job}, month ${month}`,
      );
    }
  }
});

test("the cutoff is what the fix IS — without it August inherits September", () => {
  // The regression this exists to catch: dropping the cutoff silently restores the
  // reported bug, and every other assertion here would still pass.
  const asOf = monthEndCutoff("2026-08");
  const withCutoff = rawLeftToInvoice(JOBS["1162"], { asOf });
  const lifetime = rawLeftToInvoice(JOBS["1162"], {});
  assert.equal(lifetime - withCutoff, 61499.68, "a September PO is not August exposure");
  assert.notEqual(withCutoff, lifetime);
  // And the ETC page must actually pass a month — a default of "lifetime" here reads
  // as working code and is the whole defect.
  const page = readFileSync(join(process.cwd(), "src", "app", "(app)", "etc", "page.tsx"), "utf8");
  // `\r?\n`, not `\n`: this repo's worktree is CRLF, and an earlier pass of this file
  // happened to be written with LF, so the guard passed for a reason that had nothing
  // to do with what it checks. A source guard must not depend on line endings.
  assert.match(page, /readPartsEtcBreakout\([\s\S]{0,400}?\r?\n\s*month,\s*\r?\n\s*\)/, "the ETC page must pass its month");
  const breakout = readFileSync(join(process.cwd(), "src", "lib", "parts-etc-breakout.ts"), "utf8");
  // explainLeftToInvoice, not leftToInvoiceForLines — same arithmetic (`total` IS what
  // leftToInvoiceForLines returns), and it also yields the floor and drift figures the
  // tooltip discloses. The assertion that matters is that the CUTOFF is passed.
  assert.match(breakout, /explainLeftToInvoice\(lines, \{ asOf \}\)/);
  assert.match(breakout, /month: string \| null,/, "month must be required, not optional");
});

test("there is ONE formula — no caller re-expresses it", () => {
  // The report's actual instruction: reuse the shared calculation, do not add a
  // second one. This fails the moment somebody spells the subtraction out again.
  const files = [
    ["src/lib/parts-etc-breakout.ts", "Monthly ETC"],
    ["src/lib/po-detail.ts", "the Parts List rows"],
    ["src/lib/parts-budget-projection.ts", "the projection"],
    ["src/lib/parts-cost-financials.ts", "the Parts Cost card"],
  ] as const;
  for (const [rel, who] of files) {
    const src = readFileSync(join(process.cwd(), ...rel.split("/")), "utf8");
    const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.match(code, /from "@\/lib\/left-to-invoice"/, `${who} must import the shared formula`);
    assert.ok(
      !/totalPrice\s*-\s*(l\.)?actualAmount/.test(code),
      `${who} re-expresses "totalPrice − actualAmount" instead of calling the shared function`,
    );
  }
});

test("a mismatch names the rows that caused it", () => {
  // "log enough detail to show which part/PO rows are causing it rather than silently
  // returning different numbers."
  const asOf = monthEndCutoff("2026-08");
  const x = explainLeftToInvoice(JOBS["1162"], { asOf });
  assert.equal(cents(x.total), 2905.22);
  assert.equal(cents(x.raw), 2905.22);
  assert.equal(x.linesIncluded, 3);
  assert.equal(x.linesExcluded, 1);
  assert.deepEqual(
    x.excludedByCutoff.map((e) => [e.poNumber, e.partNumber, e.purchaseDate, e.amount]),
    [["C4", "R-4", "2026-09-01", 61499.68]],
  );
  // The figure this rule knowingly leaves moving: $5,000 posted on 2026-09-04
  // against a PO placed 2026-08-20 already reduces August's number.
  assert.equal(x.postedAfterCutoff, 5000);

  // The floor is reported too, so "$0" is never mistaken for "nothing outstanding".
  const over = explainLeftToInvoice([line({ purchaseDate: "2026-08-02", totalPrice: -427.54 })], { asOf });
  assert.equal(over.total, 0);
  assert.equal(over.raw, -427.54);
});

test("asOfPosting freezes the month instead of letting it drift", () => {
  // Not the default — the Parts List does not do this and the Parts List is the
  // stated source of truth — but implemented and pinned, because the difference is
  // real money ($76,866.43 in August) and switching must be one option, not a rewrite.
  const asOf = monthEndCutoff("2026-08");
  const drifting = rawLeftToInvoice(JOBS["1162"], { asOf });
  const frozen = rawLeftToInvoice(JOBS["1162"], { asOf, asOfPosting: true });
  // Cents, not raw floats: 344 + 2561.22 lands on 2905.2199999999998 in binary
  // floating point, and a money assertion that fails on the 13th decimal is noise.
  assert.equal(cents(drifting), 2905.22, "September posting already reduces August");
  assert.equal(cents(frozen), 7905.22, "as of 31 August that $5,000 had not posted yet");
  assert.equal(cents(frozen - drifting), 5000);
  // On a job with no late postings the two agree, so this is inert where it should be.
  assert.equal(
    rawLeftToInvoice(JOBS["1130"], { asOf }),
    rawLeftToInvoice(JOBS["1130"], { asOf, asOfPosting: true }),
  );
});

// ── The two remaining differences must be visible, not just documented ───────
//
// Neither is a calculation error and neither is going away:
//
//   FLOOR    Monthly ETC floors each job at 0; the Parts List's column is a signed
//            per-row sum and must stay signed, because over-invoicing is the reason
//            to look at it. Two jobs in August 2026 — 1134 (−$427.54) and 1149
//            (−$93.74), $521.28 together.
//   DRIFT    The Parts List's rule pairs a purchase-date cutoff with LIFETIME
//            invoicing, so a posting dated after month end still reduces that month.
//            31 of 49 jobs, $76,866.43. It does NOT break parity — both surfaces
//            drift together — but a closed month's figure keeps moving.
//
// A difference a manager can only find by re-adding the numbers is the same class of
// problem as the mismatch this change fixed, so both are surfaced on the cell.

test("monthEndLabel names the same day the arithmetic uses", () => {
  // One derivation, so the words and the cutoff cannot disagree. It was an IIFE inside
  // etc/page.tsx, which no test could call.
  assert.equal(monthEndLabel("2026-08"), "August 31, 2026");
  assert.equal(monthEndLabel("2026-02"), "February 28, 2026");
  assert.equal(monthEndLabel("2024-02"), "February 29, 2024", "leap year");
  assert.equal(monthEndLabel("2026-12"), "December 31, 2026");
  for (const bad of ["", "2026-13", "nonsense", null, undefined]) {
    assert.equal(monthEndLabel(bad), "the end of the month", `${bad} must not invent a date`);
  }
  // And it always describes the day monthEndCutoff actually applies.
  for (const m of ["2026-01", "2026-06", "2026-08", "2024-02"]) {
    const cutoff = monthEndCutoff(m)!;
    assert.ok(monthEndLabel(m).includes(String(Number(cutoff.slice(8, 10)))), `${m}: label must name day ${cutoff}`);
  }
});

test("an over-invoiced job reports its floor instead of a bare $0", () => {
  // Job 1134's shape: one settled line and a credit, netting negative.
  const overInvoiced = [
    line({ purchaseDate: "2026-08-05", invoicedDate: "2026-08-11", totalPrice: 500, actualAmount: 500 }),
    line({ purchaseDate: "2026-08-06", invoicedDate: "2026-08-12", totalPrice: -427.54 }),
  ];
  const x = explainLeftToInvoice(overInvoiced, { asOf: monthEndCutoff("2026-08") });
  assert.equal(x.total, 0, "the cell shows 0 — a job cannot owe negative money");
  assert.equal(cents(x.raw), -427.54, "and the raw figure is carried so the cell can say why");
  assert.ok(x.raw < x.total, "raw below total is exactly the floored case");
  // The Parts List's column is the raw one. That is the difference, and it is now
  // derivable from what the grid carries rather than only from a comment.
  assert.equal(cents(x.raw), cents(partsListLeftToInvoice(overInvoiced, monthEndCutoff("2026-08"))));
});

test("a job with no late postings reports no caveat at all", () => {
  // The disclosure has to be inert where it does not apply, or it is noise on 18 of
  // August's 49 jobs.
  const clean = explainLeftToInvoice(JOBS["1130"], { asOf: monthEndCutoff("2026-08") });
  assert.equal(clean.postedAfterCutoff, 0);
  assert.equal(clean.raw, clean.total, "nothing floored");
});

test("the grid carries both caveats out of the data layer", () => {
  // Structural: a figure the page cannot explain is a figure that will be re-reported
  // as a bug. These three fields are what the tooltip is built from.
  const breakout = readFileSync(join(process.cwd(), "src", "lib", "parts-etc-breakout.ts"), "utf8");
  assert.match(breakout, /rawLeftToInvoice: number \| null;/);
  assert.match(breakout, /postedAfterCutoff: number;/);
  assert.match(breakout, /const x = explainLeftToInvoice\(lines, \{ asOf \}\);/);

  const page = readFileSync(join(process.cwd(), "src", "app", "(app)", "etc", "page.tsx"), "utf8");
  assert.match(page, /const cutoffLabel = monthEndLabel\(month\);/, "the page must use the shared label");
  assert.ok(!/const monthEndLabel = \(\(\) =>/.test(page), "the untestable inline copy must be gone");
  assert.match(page, /suggestionWasFloored/, "the floor must reach the tooltip");
  assert.match(page, /suggestionLatePostings/, "the drift must reach the tooltip");
  // The tooltip states the cutoff date, which is what makes the figure self-describing.
  assert.match(page, /not yet invoiced as of \$\{cutoffLabel\}/);
});

// ── Why there is no submission-time snapshot ─────────────────────────────────
//
// Considered on 2026-09-04 and rejected on the evidence, which these tests pin so the
// idea is not re-proposed from memory:
//
//   1. The submission never reads this figure. monthly-report.ts freezes
//      `newEtcDraft ?? suggestNewEtc(priorEtc, hoursWorked)` — the carry-forward
//      suggestion. The upstream Left to Invoice number never enters history.
//   2. Nothing downstream reads it. Its ONLY consumer is the empty cell's tooltip.
//   3. A frozen copy would no longer equal the Parts List, which is always live —
//      reintroducing the reported mismatch in a narrower place.
//
// What the drift actually justified is smaller and free: on a closed month, do not
// quote a moving number at all.

test("the submission freezes the carry-forward suggestion, not the upstream figure", () => {
  // Point 1. If this ever changes, a snapshot becomes a real question again.
  const report = readFileSync(join(process.cwd(), "src", "lib", "monthly-report.ts"), "utf8");
  assert.match(report, /const newEtc = draft \?\? round2\(suggestNewEtc\(priorEtc, hoursWorked\)\);/);
  assert.ok(
    !/leftToInvoice|readPartsEtcBreakout|left-to-invoice/.test(report.replace(/\/\/.*$/gm, "")),
    "the submission must not depend on the live upstream Left to Invoice figure",
  );
});

test("the upstream figure reaches exactly one place: an empty cell's tooltip", () => {
  // Point 2. A second consumer would mean a drifting number somewhere that matters.
  const page = readFileSync(join(process.cwd(), "src", "app", "(app)", "etc", "page.tsx"), "utf8");
  const code = page.replace(/\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  // The suggestion is read once and used only to build seedHint.
  assert.equal((code.match(/partsBreakout\?\.byJobPk\.get/g) ?? []).length, 1);
  assert.ok(!/leftToInvoiceValue = [^;]*suggest/.test(code), "the suggestion must never become the cell's value");
  assert.ok(
    !/partsCostGrandTotal\.leftToInvoice \+= [^;]*suggest/.test(code),
    "the suggestion must never enter the footer total",
  );
  // And the cell only shows a hint while it is empty (PartsBreakoutCell).
  const cell = readFileSync(join(process.cwd(), "src", "components", "PartsBreakoutCell.tsx"), "utf8");
  assert.match(cell, /value\.trim\(\) === "" && seedHint/);
});

test("a closed month is told nothing rather than something stale", () => {
  // The fix the drift actually justified. Gated on the ROW's needsReview, not on
  // cellsReadOnly — that folds in the monthly-etc:edit permission, and a viewer
  // without it looking at an open month should still see the live figure.
  const page = readFileSync(join(process.cwd(), "src", "app", "(app)", "etc", "page.tsx"), "utf8");
  assert.match(page, /!partsCostEntry\.needsReview\s*\?\s*`This month is closed and nobody entered a figure here\./);
  assert.ok(
    !/cellsReadOnly\s*\?\s*`This month is closed/.test(page),
    "must not gate on the permission-bearing flag",
  );
  // The closed-month text points at the source of truth instead of quoting a number.
  const closed = page.slice(page.indexOf("This month is closed"), page.indexOf("This month is closed") + 400);
  assert.ok(!/currencyExact\(suggested/.test(closed), "a closed month must not quote the live figure");
  assert.match(closed, /Parts List filtered through \$\{cutoffLabel\}/);
});

// ── What the CELL shows, which is not what the rows compute ────────────────
//
// The 2026-09-04 report photographed $10,000 in a column the Parts List put at
// $35,496 and asked for a root-cause fix. The arithmetic above was not the cause: the
// column is manager-entered, so it shows a stored figure or a pre-breakout hand-typed
// New ETC, and the computed figure only ever reaches an empty cell's tooltip. That
// rule was written out twice, mirrored by hand, and the audit was about to need it a
// third time — so it lives in one place now, and these are its cases.

test("a stored figure is what the cell shows", () => {
  assert.equal(shownLeftToInvoice({ leftToInvoice: 1234.5, leftToPurchase: null, newEtcDraft: 9999 }), 1234.5);
  assert.equal(shownLeftToInvoiceSource({ leftToInvoice: 1234.5, leftToPurchase: null, newEtcDraft: 9999 }), "stored");
  // Zero is a figure a manager entered, not an absence.
  assert.equal(shownLeftToInvoice({ leftToInvoice: 0, leftToPurchase: null, newEtcDraft: 500 }), 0);
});

test("a pre-breakout New ETC carries in, but ONLY while both halves are unanswered", () => {
  // This is the case in every row of the report's screenshot, and it is why each one
  // equalled its own New ETC exactly and reconciled with nothing.
  assert.equal(shownLeftToInvoice({ leftToInvoice: null, leftToPurchase: null, newEtcDraft: 10000 }), 10000);
  assert.equal(
    shownLeftToInvoiceSource({ leftToInvoice: null, leftToPurchase: null, newEtcDraft: 10000 }),
    "carried-new-etc",
  );
  // Once the OTHER half is stored, the halves are the truth and the draft is merely
  // their sum — reading it back would double-count it.
  assert.equal(shownLeftToInvoice({ leftToInvoice: null, leftToPurchase: 2500, newEtcDraft: 10000 }), null);
  assert.equal(shownLeftToInvoiceSource({ leftToInvoice: null, leftToPurchase: 2500, newEtcDraft: 10000 }), "blank");
});

test("nothing stored anywhere is blank, which is the only state that reconciles", () => {
  // A blank cell shows the computed figure as its hint, so it agrees with the Parts
  // List by construction. Every other state is a number somebody typed.
  assert.equal(shownLeftToInvoice({ leftToInvoice: null, leftToPurchase: null, newEtcDraft: null }), null);
  assert.equal(shownLeftToInvoiceSource({ leftToInvoice: null, leftToPurchase: null, newEtcDraft: null }), "blank");
});

test("the rule has ONE implementation — the grid, the save and the audit all call it", () => {
  // The specific duplication the report asked to end. Both call sites used to spell
  // the rule out; a third copy was about to be written for the audit.
  const page = readFileSync(join(process.cwd(), "src", "app", "(app)", "etc", "page.tsx"), "utf8");
  const actions = readFileSync(join(process.cwd(), "src", "lib", "etc-actions.ts"), "utf8");
  const audit = readFileSync(join(process.cwd(), "scripts", "audit-left-to-invoice-parity.ts"), "utf8");
  for (const [name, src] of [["the ETC page", page], ["the save action", actions], ["the audit", audit]] as const) {
    assert.ok(src.includes("shownLeftToInvoice"), `${name} must call the shared rule`);
  }
  // And none of them may re-derive it. The signature of the old copies was a
  // three-way test against newEtcDraft.
  for (const [name, src] of [["the ETC page", page], ["the save action", actions]] as const) {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(
      !/leftToPurchase\s*==?=?\s*null\s*&&[\s\S]{0,80}newEtcDraft/.test(code),
      `${name} still re-derives the carry rule`,
    );
  }
});

test("the audit compares what is DISPLAYED, not just two calculations", () => {
  // The gap that let this ship looking fixed: the audit measured rows against rows and
  // reported parity while the screen disagreed. It now reads the stored fields and
  // prints the Job / Parts List / Monthly ETC / difference table that was asked for.
  const audit = readFileSync(join(process.cwd(), "scripts", "audit-left-to-invoice-parity.ts"), "utf8");
  assert.match(audit, /leftToInvoice: true, leftToPurchase: true, newEtcDraft: true/, "it must read the stored cells");
  assert.ok(audit.includes("DISPLAYED:"), "it must report the displayed comparison");
  assert.ok(audit.includes("does not reconcile"), "it must count the mismatches");
  // And name the contributing rows, so a mismatch is traceable.
  assert.ok(audit.includes("EXCLUDED (after cutoff)"));
  assert.match(audit, /shownLeftToInvoiceSource/, "each figure must say where it came from");
});
