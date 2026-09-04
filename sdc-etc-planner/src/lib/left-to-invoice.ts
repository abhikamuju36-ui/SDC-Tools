import type { PartsCostLine } from "@/lib/sync-totaleto";

// ── Left to Invoice — ONE formula, one cutoff, every caller ───────────────────
//
// REPORTED 2026-09-03: Monthly ETC → Parts Cost → Left to Invoice disagreed with
// Job Details → Parts List filtered through 08/31/2026.
//
// ── What the audit found (scripts/audit-left-to-invoice-parity.ts) ───────────
//
// Measured over August 2026's 49 Parts Cost jobs, against the same upstream rows:
//
//     Monthly ETC as shipped          $2,238,624.84
//     Parts List through 2026-08-31   $2,137,726.85
//     difference                        $100,897.99
//
// and the difference decomposes exactly:
//
//     $100,376.71   lines PURCHASED AFTER 2026-08-31 (Sept 1–3 POs)
//         $521.28   the aggregate floor at 0 (one job, 1134, sits at −$427.54)
//
// That is the whole gap. Everything the report asked me to check for came back
// clean, and it is worth writing down which, because each one is a thing that did
// NOT need fixing:
//
//   • date field        Both read PartsCostLine.purchaseDate / .invoicedDate from
//                       the same query template (partsDetailSql).
//   • timezone          Upstream sends ISO `YYYY-MM-DD…` strings. Both sides do
//                       `.slice(0, 10)` and compare as strings. No Date object is
//                       ever constructed, so there is no zone to get wrong.
//   • end-date bound    Inclusive on both sides (`day > to` excludes), so
//                       2026-08-31 keeps that day's purchases.
//   • invoiced vs GL    Both use `actualAmount` (GL-posted), not `invoicedAmount`
//                       (billed). Worth $378,989.26 in August if they diverged —
//                       they do not. po-detail.ts fixed its side on 2026-09-02.
//   • refunds/credits   `applyRefundSign` runs inside getPartsCostForJobs, so both
//                       callers receive already-signed lines.
//   • zero-value rows   `meaningfulLines` drops them inside the same function.
//   • partial invoices  A line's own `totalPrice − actualAmount` carries its
//                       remaining balance; nothing here needs to know it is partial.
//   • duplicate lines   Both sum every PO line once. The Parts List additionally
//                       share-splits a line across the BOM rows that claim it
//                       (`shareOf`), which redistributes but never duplicates.
//   • supplier/mfr      normalizeVendor touches display and filtering only. It has
//                       never been in the money path.
//   • job filtering     Both start from the same job set for the month.
//   • BOM/non-BOM       Not a money distinction. See the note on the footer below.
//
// So this file does not introduce a second formula to make two numbers agree. It
// extracts the ONE formula those numbers were already computing — in four places,
// written out four times — and gives it the cutoff that Monthly ETC never had.
//
// ── The cutoff is the actual defect ─────────────────────────────────────────
//
// Monthly ETC's figure was "as of right now" on a page whose entire job is closing
// a named month. Opening August on September 3rd counted three days of September
// POs as August exposure, and the number moved every day the month stayed open. A
// month-end figure has to be a month-end figure.
//
// ── What "as of" means here, and the one thing it does NOT do ───────────────
//
// `asOf` excludes lines PURCHASED after the cutoff. It does not un-apply invoices
// posted after it. That is deliberate: it is what the Parts List's own date filter
// does (Purchase mode is the only mode that yields this column at all — an
// Invoiced-mode range renders it as "—", by design, because a windowed invoiced
// figure against a lifetime purchased figure is not a subtraction anyone should
// read), and the Parts List is the stated source of truth.
//
// It is worth knowing what that costs, because it is not zero: in August,
// $76,866.43 of GL-posted actual landed after the 31st against POs placed on or
// before it. Under this rule those dollars reduce the August figure retroactively,
// so August's Left to Invoice keeps drifting down as September posts. A true
// as-of-31-August snapshot — `asOfPosting: true` below — holds still instead.
// Both are implemented; the Parts List's rule is the default because it is the one
// that was asked for.

/** An inclusive `YYYY-MM-DD` cutoff, or null for "everything, lifetime". */
export type LeftToInvoiceScope = {
  /**
   * Include only lines purchased on or before this day. Null/absent = lifetime,
   * which is what the Parts Cost card and the job-level tiles want.
   */
  asOf?: string | null;
  /**
   * Also ignore GL postings dated after `asOf`, giving a true point-in-time
   * snapshot rather than "August's POs, today's invoices". Off by default: the
   * Parts List does not do this, and the Parts List is the source of truth.
   */
  asOfPosting?: boolean;
};

/** `2026-08` → `2026-08-31`. Null for anything that is not a `YYYY-MM` month. */
export function monthEndCutoff(month: string | null | undefined): string | null {
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [y, m] = month.split("-").map(Number);
  // Day 0 of the next month is the last day of this one — leap years included,
  // and computed in local time on a date that is only ever read as Y/M/D.
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}

/**
 * The cutoff written for a human: `2026-08` → `August 31, 2026`.
 *
 * Lives here, beside monthEndCutoff, so the words and the arithmetic cannot name
 * different days — it was an inline IIFE in etc/page.tsx, which is a 2,500-line server
 * component no test can call. `new Date(y, m - 1, d)` is the numeric constructor on a
 * value that only ever gets formatted, never compared, so it carries no timezone risk;
 * the money path still never parses a date string.
 */
export function monthEndLabel(month: string | null | undefined): string {
  const cutoff = monthEndCutoff(month);
  if (!cutoff) return "the end of the month";
  const [y, m, d] = cutoff.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * The day part of an upstream timestamp, as a string.
 *
 * Never `new Date(...)`. Upstream sends ISO `YYYY-MM-DD…`, and lexical comparison
 * of those prefixes is exact — whereas parsing to a Date and back reintroduces the
 * server's UTC offset, which can move a purchase across a month boundary. This is
 * the same `.slice(0, 10)` the Parts List's own filter uses, deliberately.
 */
export function dayOf(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const d = ts.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/**
 * Is this line part of the picture as of the cutoff?
 *
 * A line with NO purchase date is INCLUDED. This is the one place this file
 * deliberately departs from the Parts List's filter, which drops undated rows via
 * its `if (!d) return false` guard — a rule that is right for a table (you cannot
 * sort undated rows into a date range) and wrong for a total (an undated
 * commitment is still a commitment, and silently dropping it understates the
 * exposure). It cost nothing in August — every line had a purchase date, so
 * `droppedNoPurchaseDate` measured $0.00 — but "currently zero" is not a reason to
 * build in a leak.
 */
export function isWithinAsOf(line: PartsCostLine, asOf: string | null | undefined): boolean {
  if (!asOf) return true;
  const purchased = dayOf(line.purchaseDate);
  if (purchased === null) return true;
  return purchased <= asOf; // inclusive, matching the Parts List's `day > to` exclusion
}

/**
 * One line's contribution: what was committed on it, less what has posted to the GL.
 *
 * Signed. A line whose posted spend exceeds its purchased total is a credit and
 * must net against its neighbours rather than being clamped away on its own — the
 * flooring belongs on the aggregate, and only there.
 */
export function lineLeftToInvoice(line: PartsCostLine, scope: LeftToInvoiceScope = {}): number {
  const posted =
    scope.asOfPosting && scope.asOf && (dayOf(line.invoicedDate) ?? "9999-12-31") > scope.asOf ? 0 : line.actualAmount;
  return line.totalPrice - posted;
}

/**
 * Left to Invoice for a set of lines — THE definition, for every caller.
 *
 * Floored at 0 on the AGGREGATE. A job cannot owe negative money to its suppliers,
 * and this figure seeds a forecast; the per-line signed value stays available above
 * for the Parts List's own column, which shows real negatives on purpose.
 */
export function leftToInvoiceForLines(lines: readonly PartsCostLine[], scope: LeftToInvoiceScope = {}): number {
  return Math.max(0, rawLeftToInvoice(lines, scope));
}

/** The same sum WITHOUT the aggregate floor — what the Parts List footer column shows. */
export function rawLeftToInvoice(lines: readonly PartsCostLine[], scope: LeftToInvoiceScope = {}): number {
  let total = 0;
  for (const line of lines) {
    if (!isWithinAsOf(line, scope.asOf)) continue;
    total += lineLeftToInvoice(line, scope);
  }
  return total;
}

export type LeftToInvoiceExplanation = {
  total: number;
  /** Before the aggregate floor — differs from `total` only on an over-posted job. */
  raw: number;
  linesIncluded: number;
  linesExcluded: number;
  /** What the cutoff removed, and what it was worth. Empty when `asOf` is null. */
  excludedByCutoff: { poNumber: string | null; partNumber: string | null; purchaseDate: string | null; invoicedDate: string | null; amount: number }[];
  /** GL postings dated after the cutoff that this rule still subtracts (see the header). */
  postedAfterCutoff: number;
};

/**
 * The same arithmetic, showing its work.
 *
 * Exists because "these two numbers differ" must never be answerable only by
 * re-deriving both by hand. When a reconciliation test fails, or a manager asks why
 * a job moved, this names the PO lines responsible and what each was worth.
 */
export function explainLeftToInvoice(
  lines: readonly PartsCostLine[],
  scope: LeftToInvoiceScope = {},
): LeftToInvoiceExplanation {
  const excluded: LeftToInvoiceExplanation["excludedByCutoff"] = [];
  let raw = 0;
  let included = 0;
  let postedAfterCutoff = 0;
  for (const line of lines) {
    if (!isWithinAsOf(line, scope.asOf)) {
      excluded.push({
        poNumber: line.poNumber,
        partNumber: line.partNumber,
        purchaseDate: dayOf(line.purchaseDate),
        invoicedDate: dayOf(line.invoicedDate),
        amount: line.totalPrice - line.actualAmount,
      });
      continue;
    }
    included++;
    raw += lineLeftToInvoice(line, scope);
    if (scope.asOf && (dayOf(line.invoicedDate) ?? "") > scope.asOf) postedAfterCutoff += line.actualAmount;
  }
  return {
    total: Math.max(0, raw),
    raw,
    linesIncluded: included,
    linesExcluded: excluded.length,
    excludedByCutoff: excluded,
    postedAfterCutoff,
  };
}

// ── What the CELL shows — computed, not entered (2026-09-04) ─────────────────
//
// The reconciliation report was answered with a decision: "Monthly ETC Left to
// Invoice = Parts List Left to Invoice … exact reconciliation every time." That
// settles a conflict rather than adding a feature, so it is worth writing down what
// it overrides.
//
// On 2026-09-03 this column was made a manager-entered cell, with New ETC as the sum
// of it and Left to Purchase. A typed figure cannot equal a computed one, so the
// column disagreed with the Parts List by whatever a manager had typed — $10,000
// against $35,496 in the report's screenshots — and no change to the arithmetic
// above could have closed that gap. Editable and always-equal-to-upstream are
// different things, and always-equal won.
//
// So Left to Invoice is now COMPUTED and read-only. `rawLeftToInvoice` is what it
// shows: the signed per-line sum through the month-end cutoff, which is exactly what
// the Parts List's own column sums. Not the floored figure — flooring at zero is the
// one place the two legitimately disagreed (two August jobs, $521.28 together), and
// "exact" leaves no room for it. An over-invoiced job now reads negative here, as it
// already does there, because that is true and it is the reason to look.
//
// Left to Purchase stays manager-entered. It always was the half nobody can compute:
// a BOM part with no purchase line does not appear in the parts rows at all.

/** Where a displayed Left to Invoice came from. The audit prints it. */
export type LeftToInvoiceSource =
  /** Live from Total ETO through the month-end cutoff — an open month. */
  | "computed"
  /** Frozen when the row was submitted, so a closed month cannot drift. */
  | "frozen"
  /** A closed row with nothing frozen (submitted before this change), recomputed. */
  | "recomputed"
  /** Upstream is unreachable and nothing was frozen. Renders as an em dash. */
  | "unavailable";

export type LeftToInvoiceInputs = {
  /** The Parts List figure at this month's cutoff, or null when upstream failed. */
  computed: number | null;
  /** What was written to EtcEntry.leftToInvoice when the row was submitted. */
  stored: number | null;
  /** The row has been submitted — `!needsReview`. */
  submitted: boolean;
};

/**
 * The figure the cell shows, and why.
 *
 * A SUBMITTED row prefers what was frozen at submission. Two reasons, and both
 * matter: a closed month's numbers are history and must not move, and this figure
 * genuinely does drift — the Parts List's rule pairs a purchase-date cutoff with
 * lifetime invoicing, so a September posting against an August PO keeps reducing
 * August. Freezing is what stops a signed-off month rewriting itself.
 *
 * An OPEN row prefers the computed figure, and that is the whole point of the change:
 * whatever is stored on an open row is a superseded manual entry, so it must not win.
 * It is still used as a fallback when upstream is unreachable, because a stale number
 * that says where it came from beats an em dash on the column New ETC is built from.
 */
export function resolveLeftToInvoice(x: LeftToInvoiceInputs): { value: number | null; source: LeftToInvoiceSource } {
  if (x.submitted) {
    if (x.stored !== null) return { value: x.stored, source: "frozen" };
    if (x.computed !== null) return { value: x.computed, source: "recomputed" };
    return { value: null, source: "unavailable" };
  }
  if (x.computed !== null) return { value: x.computed, source: "computed" };
  if (x.stored !== null) return { value: x.stored, source: "frozen" };
  return { value: null, source: "unavailable" };
}
