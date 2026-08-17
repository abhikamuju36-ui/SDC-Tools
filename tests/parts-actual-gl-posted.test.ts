import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Parts Actual must never again report commitment or forecast (2026-08-10) ──
//
// Reported by Dan: job 1116's Parts Cost actual/projection read ~$400K against a
// job ledger of ~$340K on a ~$300K budget. Audited against Lisa's own
// "1116 Molex as of 7.31.26" Job Ledger export ($349,732.10 net, re-derivable by
// scripts/_analyze_1116_ledger.ts). The app said $399,176.51, and TWO general
// causes produced it — neither specific to 1116:
//
//   1. SUM([Total Price]) carries each open PO's UNINVOICED remaining balance, so
//      a job's undelivered commitment was reported as money already spent.
//      $32,986.24 on 1116; $2,108,517.44 across all jobs.
//   2. AP documents flagged APDocDoNotExport never post to the general ledger, so
//      they can never appear on a job ledger — but were counted as spend anyway.
//      $19,950.40 on 1116; $621,483.80 across the database.
//
// After the fix all 100 TotalETO-tracked jobs reconcile to their source figure to
// the cent (scripts/parts-actual-recon.ts re-proves it live, which is where the
// real verification lives — these are the cheap structural guards that stop the
// specific shapes of the bug returning).
//
// Source-inspecting rather than live, for the same reason the sibling parts tests
// are: there is no TotalETO connection in CI.

const ROOT = join(import.meta.dirname, "..");
function code(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/[^\n]*$/gm, "")
    .replace(/\/\/[^\n"'`]*$/gm, "");
}

function functionSpan(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} must exist in the source`);
  const nextExport = source.indexOf("\nexport ", start + 1);
  return nextExport === -1 ? source.slice(start) : source.slice(start, nextExport);
}

const SYNC_TOTALETO = () => code("src", "lib", "sync-totaleto.ts");

// ── Root cause 1: commitment must not be reported as actual ─────────────────

test("syncPartsCostActual fills the Parts Actual column from getPartsActualByJob", () => {
  const fn = functionSpan(SYNC_TOTALETO(), "syncPartsCostActual");
  assert.match(fn, /getPartsActualByJob\(\)/, "the column labelled ACTUAL must come from the GL-posted AP basis");
  assert.doesNotMatch(
    fn,
    /getPartsCostSpentByJob/,
    "SUM([Total Price]) includes every open PO's undelivered balance — that is a commitment, and reporting it as actual is the original 1116 bug",
  );
});

test("getPartsActualByJob sums AP document lines, never [Total Price]", () => {
  const fn = functionSpan(SYNC_TOTALETO(), "getPartsActualByJob");
  assert.match(fn, /tblAPDocumentDetails/, "Parts Actual is an AP-document sum");
  assert.doesNotMatch(fn, /\[Total Price\]/, "[Total Price] is remaining-open-balance + invoiced-to-date, i.e. a commitment");
  assert.doesNotMatch(fn, /PurchasePrice/, "a PO's own price is what was committed, not what was spent");
});

test("the projection is based on Parts Actual, not on the committed total", () => {
  const proj = code("src", "lib", "parts-budget-projection.ts");
  const fn = functionSpan(proj, "computePartsBudgetProjection");
  assert.match(fn, /actualTotal\(lines\)/, "the projection's actual term must be the GL-posted actual");
  assert.match(
    fn,
    /committedNotPosted/,
    "open/unposted commitment must ride as its OWN term, computed and returned for display, even though it no longer feeds `total`",
  );
});

// ── Left to be invoiced must never be summed into Projection again (2026-08-17) ─
//
// Reported and confirmed on real project data: Invoiced $47,192 + Left to be
// invoiced $84,877 + ETC $165,313 summed to $297,382, well past the $212,505
// (Invoiced + ETC) a manager's own New ETC — already an estimate of what's
// left to FINISH the job, which has to account for whatever's on order —
// actually implies. Root cause: the Parts New ETC that becomes
// `estimateToPurchase` is drawn down by GL-posted spend only
// (getPartsCostBookedByJob, the same basis as `actual`), never by an open
// PO's balance, so `committedNotPosted` money stays inside it, undiminished,
// until that PO is actually invoiced. Summing it in on top of `actual` counted
// it twice.

test("computePartsBudgetProjection's total is actual + estimateToPurchase, NOT + committedNotPosted", () => {
  const proj = code("src", "lib", "parts-budget-projection.ts");
  const fn = functionSpan(proj, "computePartsBudgetProjection");
  assert.match(fn, /total:\s*actual\s*\+\s*estimateToPurchase/, "the double-count fix: committedNotPosted must not be added into total");
  assert.doesNotMatch(
    fn,
    /total:\s*actual\s*\+\s*committedNotPosted\s*\+\s*estimateToPurchase/,
    "this is the exact formula that double-counted Left to be invoiced — it must not come back",
  );
});

test("the audit script's own defining identity checks invoiced+etc, not invoiced+leftToInvoice+etc", () => {
  const audit = code("scripts", "parts-cost-projection-audit.ts");
  assert.match(audit, /const expectedProjection = invoiced \+ \(etc \?\? 0\)/, "the audit's PROJECTION FORMULA MISMATCH check must match the fixed formula");
  assert.doesNotMatch(audit, /invoiced \+ leftToInvoice \+ \(etc \?\? 0\)/, "the audit must not silently re-assert the pre-fix formula");
});

test("the Parts Cost card's bar stacks exactly two segments — Invoiced and ETC — never Left to be invoiced", () => {
  const src = code("src", "components", "PartsCostSummary.tsx");
  assert.match(
    src,
    /const segments: \{[\s\S]{0,120}\}\[\] = \[\s*\{ key: "invoiced"/,
    "the segments array must start with Invoiced",
  );
  assert.doesNotMatch(
    src,
    /key: "left-to-invoice"/,
    "Left to be invoiced must never be a bar segment again — it is money already inside ETC, not an increment on top of it",
  );
  // The bar's own two-segment sum must be reconciled against Projection using
  // Invoiced (not Invoiced+LeftToInvoice) — see the rounding-residue fix.
  assert.match(
    src,
    /const etcDisplay = hasProjection \? Math\.max\(0, projTotalDisplay - invoicedDisplay\) : 0/,
    "the ETC segment must absorb rounding residue against Invoiced alone, not against totalSpentDisplay (which still includes Left to be invoiced)",
  );
});

test("Left to be invoiced is still shown, as an informational chip labelled Included in ETC", () => {
  const src = code("src", "components", "PartsCostSummary.tsx");
  assert.match(
    src,
    /<SegmentMarker color=\{BAR_SPENT\} label="Left to be invoiced" value=\{leftToInvoiceDisplay\} note="Included in ETC" informational \/>/,
    "Left to be invoiced must remain visible, explicitly marked as informational (not a bar segment) and labelled as included in ETC",
  );
});

test("Total Parts Cost Spent is untouched by the fix — still Invoiced + Left to be invoiced", () => {
  // This sum was never the bug; only Projection (which also added ETC) was.
  const src = code("src", "components", "PartsCostSummary.tsx");
  assert.match(src, /const totalSpentDisplay = invoicedDisplay \+ leftToInvoiceDisplay/);
});

// ── Root cause 2: the GL-posted rule ────────────────────────────────────────

test("the GL-posted rule tests the DoNotExport flag, not the export date", () => {
  const src = SYNC_TOTALETO();
  assert.match(src, /ISNULL\(APBD\.APDocDoNotExport, 0\) = 0/, "the flag is the rule");
  // Measured 2026-08-10: 45 job-attributed AP lines / $41,352.47 had no export
  // date while NOT being flagged, every one of them dated within the previous
  // week — real invoices merely queued for the next export run. Filtering on the
  // date would delete real current cost every time someone looked before a run.
  assert.doesNotMatch(
    src,
    /APDocExportDate\s+IS\s+(?:NOT\s+)?NULL/i,
    "APDocExportDate IS NULL also matches invoices that are merely PENDING export — filtering on it silently deletes real, current cost",
  );
});

test("both branches of the per-line parts query carry an ActualAmount", () => {
  const src = SYNC_TOTALETO();
  const detail = src.slice(src.indexOf("const PARTS_DETAIL_SQL"), src.indexOf("export async function getJobPartsInvoicedInMonth"));
  const occurrences = detail.match(/AS ActualAmount/g) ?? [];
  assert.equal(
    occurrences.length,
    2,
    "the PO branch AND the Extra Costs branch both need it — on job 1116 the Extra Costs branch alone held $9,789.30 of never-posted cost, so covering only the PO branch would leave a third of the problem in place",
  );
  assert.match(detail, /LEFT JOIN tblAPBatchDocument APBD WITH\(NOLOCK\) ON APBD\.APDocID = EC\.APDocID/, "vwCostingExtraCostsDetailed exposes APDocID but not the flag, so it must join back for it");
});

test("narrowing the money must not narrow InvoicedQty", () => {
  const src = SYNC_TOTALETO();
  const detail = src.slice(src.indexOf("const PARTS_DETAIL_SQL"), src.indexOf("export async function getJobPartsInvoicedInMonth"));
  const inv = detail.slice(detail.indexOf("LEFT JOIN ( SELECT APDD.PurchaseDetailID"));
  assert.match(inv, /SUM\(APDocQty\) AS InvoicedQty/, "InvoicedQty must still count every billed document");
  assert.doesNotMatch(
    inv.slice(0, inv.indexOf("AS InvoicedQty")),
    /APDocDoNotExport/,
    "a part billed on a never-exported invoice HAS been billed; gating InvoicedQty on the flag would inflate the open-balance term and overstate the very commitment this fix removes",
  );
});

// ── Deliberate non-changes, guarded so they stay deliberate ─────────────────

test("Money Spent Month keeps its own rule and does NOT get the GL-posted filter", () => {
  // getPartsCostBookedByJob is reconciled to the business's own TotalETO pivot as
  // it stands (§41) and feeds ETC months that have been submitted and locked.
  // Applying the GL-posted rule here would move July 2026 by $13,672.97 on a
  // $491,206.43 month across 21 jobs — a retroactive change to signed-off figures.
  // That is a business decision about which reference report the monthly measure
  // follows, not a bug to fix in passing.
  const fn = functionSpan(SYNC_TOTALETO(), "getPartsCostBookedByJob");
  assert.doesNotMatch(
    fn,
    /APDocDoNotExport/,
    "changing the monthly measure would retroactively alter submitted ETC months — raise it as a decision, do not fold it into the Parts Actual fix",
  );
});

test("the per-line invoiced subquery does not group by BatchEntryTypeID", () => {
  // PART_PURCHASE_SQL does, which is a latent join fan-out: a PO line billed under
  // two different batch-entry types joins to two rows and counts its remaining
  // balance twice. Measured at zero jobs affected on 2026-08-10, so it was left
  // alone rather than "fixed" blind — but PARTS_DETAIL_SQL, which feeds every
  // per-line view and the new ActualAmount, must never acquire it.
  const src = SYNC_TOTALETO();
  const detail = src.slice(src.indexOf("const PARTS_DETAIL_SQL"), src.indexOf("export async function getJobPartsInvoicedInMonth"));
  assert.doesNotMatch(
    detail,
    /GROUP BY APDD\.PurchaseDetailID,\s*BatchEntryTypeID/,
    "grouping by BatchEntryTypeID multiplies rows per PO line and double-counts its open balance",
  );
});

// ── Every view resolves to the one definition ───────────────────────────────

test("getPartsActualByJob zero-fills jobs that have parts activity but no GL-posted spend", () => {
  const fn = functionSpan(SYNC_TOTALETO(), "getPartsActualByJob");
  assert.match(fn, /UNION ALL/, "jobs with only open POs must still appear in the map");
  // Without this, syncPartsCostActual (which iterates the map) never visits such a
  // job and its stale figure survives. Found live: after the first pass of this
  // fix, 5 of 100 jobs stayed wrong — job 1158 still reporting $99,606.54 of pure
  // open-PO commitment as actual spend, because it had no AP rows at all.
  assert.match(fn, /SELECT EC\.ProjectID AS JobId, 0 AS Actual/, "the Extra Costs job set must be zero-filled too");
});

test("Job Cost Explorer's actual column uses the shared definition", () => {
  const src = code("src", "lib", "job-cost-source.ts");
  assert.match(src, /getPartsActualByJob\(\)/, "must resolve to the same function the Projects grid does");
  assert.doesNotMatch(
    src,
    /getPartsInvoicedByJob\(/,
    "that is the same AP sum WITHOUT the GL-posted rule, so it disagreed with the Projects grid by every never-exported invoice a job had",
  );
});

test("the Parts Cost card's base bar segment comes from `financials.invoiced`, never `paid` or `purchased`", () => {
  // 2026-08-15 (audit "Audit Parts Cost Projection Formula Across All
  // Projects"): PartsCostSummary stopped taking `purchased`/`actual` as
  // separate props and now reads them off one shared `PartsCostFinancials`
  // object (src/lib/parts-cost-financials.ts) — so this guard now pins that
  // `invoiced` traces to `financials.invoiced`, one hop from the same
  // GL-posted-only source (`actualTotal`, see the test below) it always did.
  const src = code("src", "components", "PartsCostSummary.tsx");
  assert.match(src, /const invoiced = financials\.invoiced/, "the base segment is Parts Actual, not `paid` or `purchased`");
  // "Total Parts Cost Spent" was GL-posted-only (`invoiced`) from 2026-08-10
  // through 2026-08-11a — the original assertion here pinned that value. A
  // later, deliberate, by-request redesign (2026-08-11c, see that caption's
  // own comment in PartsCostSummary.tsx) intentionally moved it to
  // Invoiced + Left-to-invoice so the caption reconciles with the two bar
  // segments actually on screen instead of with the external ledger. That is
  // NOT a resurgence of the original bug: `financials.invoiced` itself — the
  // figure every OTHER test in this file guards — is untouched, still
  // GL-posted, and still what the bar's base segment and the legend's
  // "Invoiced" value show. `leftToInvoice` is an explicitly labelled, visibly
  // separate "Left to be invoiced" segment, not commitment silently relabelled
  // as spend.
  //
  // 2026-08-15: the caption now reads a pre-reconciled `totalSpentDisplay`
  // (largest-remainder rounding of [invoiced, leftToInvoice], see
  // reconcilePartsCostRounding) rather than the raw `invoiced + spentIncrement`
  // sum directly — a fix for a real, if usually sub-dollar, display artifact
  // where three independently-rounded segments didn't always sum to a
  // separately-rounded total. `totalSpentDisplay` is BY CONSTRUCTION
  // `invoicedDisplay + leftToInvoiceDisplay`, so this still guards the same
  // invariant: the caption is the bar's own two segments, not the GL-posted
  // figure alone.
  assert.match(
    src,
    /const totalSpentDisplay = invoicedDisplay \+ leftToInvoiceDisplay/,
    "totalSpentDisplay must be defined as the sum of the two displayed segments, not re-derived from a different source",
  );
  assert.match(
    src,
    /Total Parts Cost Spent:[\s\S]{0,240}usd\(totalSpentDisplay\)/,
    "this caption must render the reconciled sum of the bar's own two segments (Invoiced + Left to be invoiced), not the GL-posted figure alone",
  );
});

test("the aggregate Parts Actual sums the per-line field, via the one shared function", () => {
  // 2026-08-15: the per-job-selection aggregation this test used to pin
  // inline on job-hours/page.tsx moved into the shared
  // getPartsCostFinancials (src/lib/parts-cost-financials.ts), which is now
  // every page's one source for this number rather than each page
  // re-deriving it.
  const financials = code("src", "lib", "parts-cost-financials.ts");
  assert.match(
    financials,
    /const invoiced = actualTotal\(lines\)/,
    "getPartsCostFinancials must source Invoiced from the shared actualTotal helper, not re-sum the lines itself",
  );
  const projection = code("src", "lib", "parts-budget-projection.ts");
  assert.match(
    projection,
    /function actualTotal\(lines: PartsCostLine\[\]\)[\s\S]{0,80}total \+= l\.actualAmount/,
    "actualTotal must be summed from the same per-line field every other view uses",
  );
});
