import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Parts-cost reconciliation (2026-09-02 data-integrity audit) ─────────────
//
// The report that started this: for job 1101 the Parts List footer read Invoiced
// $290,266 while the Parts Cost card read $730,483 — same job, same word, a
// $440,217 difference and nothing on screen to say which was right.
//
// Two real defects and one legitimate scope difference, all measured against live
// Total ETO data (2,132 PO lines, 579 distinct part numbers):
//
//   1. The BOM table read only each part's NEWEST PO line, so 1,553 lines — 73% of
//      the job — were represented nowhere. Fixed: the money columns sum every line.
//   2. It summed `invoicedAmount` (billed, $749,981) where the card sums
//      `actualAmount` (GL-posted, $730,483). Fixed: both now use the GL-posted
//      basis, the app's one definition of Parts Actual.
//   3. What legitimately remains is scope — PO lines for part numbers no BOM row
//      carries. Measured after the fix: $702,967 on BOM rows + $88,643 unmatched =
//      $791,609, the card's lifetime figure exactly. Now stated in the footer.
//
// These are source-level guards: there is no DOM in this suite, and the arithmetic
// above was verified in the running app rather than simulated here.

const SRC = join(import.meta.dirname, "..", "src");
const strip = (raw: string) => raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const PO_DETAIL = strip(readFileSync(join(SRC, "lib", "po-detail.ts"), "utf8"));
const PROC = strip(readFileSync(join(SRC, "components", "JobProcurement.tsx"), "utf8"));
const FIN = strip(readFileSync(join(SRC, "lib", "parts-cost-financials.ts"), "utf8"));

test("a BOM row's cost is every PO line the part has, not just the newest", () => {
  // `?.[0]` is the newest line and is still used for DISPLAY fields (PO #, supplier,
  // dates) — those describe a purchase, not the part. It must not be what the money
  // columns are computed from.
  assert.match(PO_DETAIL, /const totalPrice = pnLines \? splitSum\(\(l\) => l\.totalPrice\)/);
  assert.match(PO_DETAIL, /\? splitSum\(\(l\) => l\.actualAmount\)/);
  assert.ok(!/const totalPrice = line\?\.totalPrice/.test(PO_DETAIL), "newest-line-only cost must not return");
  assert.ok(!/invoicedAmount = activeAttribution \? \(windowedInvoiced \?\? 0\) : \(line\?\.invoicedAmount \?\? 0\)/.test(PO_DETAIL));
});

test("the table and the card measure invoiced on the same basis", () => {
  // The whole class of bug: two views of one job summing different fields under one
  // word. `actualAmount` is the GL-posted slice and the app's one definition of
  // Parts Actual; `invoicedAmount` includes documents flagged never-to-export and is
  // $19,498 higher on job 1101.
  assert.match(FIN, /const invoiced = actualTotal\(lines\)/);
  assert.match(PO_DETAIL, /l\.actualAmount/, "the BOM table must sum the same field");
});

test("a part number on two BOM rows is split, never counted twice", () => {
  // Summing a part's whole history onto its row is right when the part has one row;
  // with two it would trade an under-count for an over-count. Measured on 1101: 529
  // BOM rows, 528 distinct part numbers — the divisor is 1 for all but one part, so
  // it exists for correctness rather than because it is load-bearing.
  assert.match(PO_DETAIL, /const shareOf = \(pn: string\) => shareCount\.get\(normPn\(pn\)\) \|\| 1;/);
  assert.match(PO_DETAIL, /\/ shareOf\(p\.pn\)/);
  // Applied to the windowed figure too — attributeInvoicedWindow already sums across
  // every line, so it needs the same division and no other change.
  assert.match(PO_DETAIL, /\(windowedInvoiced \?\? 0\) \/ shareOf\(p\.pn\)/);
});

test("the share pre-pass counts each BOM part once, over the same tree the rows come from", () => {
  // Counted by part id, like `seen` in enrich — a part reached twice through the
  // tree is one row and must be one share, or the divisor would shrink its money.
  assert.match(PO_DETAIL, /if \(counted\.has\(part\.id\)\) return;/);
  assert.match(PO_DETAIL, /for \(const section of bom\.roots\)/);
});

test("nothing is reported only as a footer summary — the rows exist", () => {
  // This started as a sentence standing in for 471 purchase lines. The footer now
  // states arithmetic over rows that are actually in the table, and the non-BOM half
  // is a button into them.
  assert.match(PROC, /onClick=\{\(\) => setScope\("nonbom"\)\}/, "the summary must be clickable");
  assert.match(PROC, /are not BOM parts/);
  assert.ok(!/more sits on .* part number/.test(PROC), "the old un-clickable summary must not return");
});

test("the footer proves it adds up, and says so when it does not", () => {
  // `unexplained` should be zero now that every purchase line becomes a row. It is
  // computed and rendered each time rather than assumed, so a future change that
  // drops rows shows up on screen instead of silently shrinking a total.
  // Estimates come out first: a BOM part with no purchase line is priced from the
  // BOM (unit x qty), so leaving it in would compare an estimate against actual PO
  // spend. Measured on 1101: $3,630, which is exactly what the guard caught when it
  // first went in.
  assert.match(PROC, /unexplained: jobTotal - \(matchedTotal - estimated\)/);
  assert.match(PROC, /p\.matchReason === "no-purchase"/);
  assert.match(PROC, /Math\.abs\(reconcile\.unexplained\) > 0\.5/);
  // Wording changed 2026-09-03 (the footer rewrite) — "Mismatch — $X unaccounted,
  // report this" replaces "$X unaccounted — report this". Still the same guard:
  // whatever the phrasing, a footer that cannot prove the sum must say so on screen.
  assert.match(PROC, /unaccounted, report this/);
  // The status is a word, not left for the reader to infer from two numbers.
  assert.match(PROC, /Fully reconciled/);
  assert.match(PROC, /Partially reconciled/);
});

test("the footer states both halves of the equation, and both add up to the job total", () => {
  // The old strip named only the non-BOM half and the job total, leaving "so what is
  // the BOM, then" as arithmetic for the reader. Both addends are stated now.
  //
  // `bomPurchased` must exclude `estimated` for the same reason `unexplained` does:
  // a BOM part with nothing bought is priced unit x qty from the BOM, so including it
  // would print BOM + non-BOM = a number LARGER than the job total, by exactly that
  // amount. An equation on screen that visibly does not balance is worse than no
  // equation, which is the whole point of this rewrite.
  assert.match(PROC, /bomPurchased: parts\.reduce\(\(sum, p\) => sum \+ p\.totalPrice, 0\) - nonBomTotal - estimated/);
  assert.match(PROC, /usd\(reconcile\.bomPurchased\)/);
  assert.match(PROC, /usd\(reconcile\.nonBomTotal\)/);
  assert.match(PROC, /usd\(reconcile\.jobTotal\)/);
});

test("the footer never mixes the visible-row scope with the job scope", () => {
  // The reported confusion: one sentence counted the rows left after every filter
  // ("56 rows shown") and then quoted a job-lifetime total ("Job lifetime $36,931"),
  // two different scopes with nothing marking the seam. They are two labelled lines
  // now, and the money line says "Whole job" whenever the row line is narrowed.
  assert.match(PROC, /narrowed: parts\.length < reconcile\.allRows/);
  assert.match(PROC, /visible\.narrowed \? "Whole job" : "Totals"/);
  // Row counts come off the RENDERED rows, so the count always matches what scrolls.
  assert.match(PROC, /for \(const p of parts\) if \(!p\.nonBom\) bomRows\+\+;/);
  // The awkward phrasing the request named, gone from the rendered output. Each is
  // still allowed to appear in a comment explaining why it went.
  const rendered = PROC.slice(PROC.indexOf('<tr className="bg-sdc-navy text-label text-white/70">'));
  assert.ok(!/every PO line each part has/.test(rendered), "the run-on sentence must not return");
  assert.ok(!/fully accounted for by the rows above/.test(rendered));
});

test("the residual describes the job, not the current filter", () => {
  // Computed over the unfiltered `parts` and every line: a supplier filter must not
  // change what "no BOM row" means.
  const block = PROC.slice(PROC.indexOf("const reconcile = useMemo("), PROC.indexOf("}, [parts, partsLines]);"));
  assert.match(block, /for \(const p of parts\)/, "unfiltered parts");
  assert.ok(!/filtered/.test(block), "must not read the filtered row set");
  assert.match(PROC, /\}, \[parts, partsLines\]\)/);
});

test("the residual is measured on the GL-posted basis, like both totals it bridges", () => {
  const block = PROC.slice(PROC.indexOf("const reconcile = useMemo("), PROC.indexOf("}, [parts, partsLines])"));
  assert.match(block, /jobInvoiced \+= l\.actualAmount/);
  assert.ok(!/l\.invoicedAmount/.test(block), "the bridge must not mix a billed figure into a GL-posted one");
});


test("a non-BOM charge is not judged by a BOM delivery status", () => {
  // Every status is a delivery state (received, due soon, late, uncovered). A
  // freight line has none, so it could only ever fail the filter — which is how 99
  // synthesized rows were counted by the scope chip and then filtered off screen.
  assert.match(PROC, /if \(!p\.nonBom && status\.size < ALL_STATUS_KEYS\.length\)/);
});

test("a BOM part with no purchase line reads as unbought, not as non-BOM", () => {
  const PO = readFileSync(join(SRC, "lib", "po-detail.ts"), "utf8");
  assert.match(PO, /!pnLines \? "no-purchase" : \(recovered \?\? "matched"\)/);
});

test("the corrected join only ever recovers a spelling of a part the BOM already has", () => {
  // Every alternate is a deterministic transform of a BOM part's own number, looked
  // up against numbers that exist. Nothing fuzzy: two genuinely different parts can
  // never be merged by this.
  const PO = readFileSync(join(SRC, "lib", "po-detail.ts"), "utf8");
  assert.match(PO, /for \(const alt of alternateKeys\(p\.pn\)\)/);
  assert.match(PO, /altLookup\.get\(alt\.key\)/);
  // Alternates are collected ALONGSIDE the exact key, not only when it misses.
  // Job 1101 has a BOM part with lines under both `MASTN20_325` and `MASTN20-325`:
  // the exact key hit, recovery never ran, and the hyphen lines stayed orphaned.
  assert.match(PO, /const exactLines = \(lineIndex\.get\(normPn\(p\.pn\)\)/);
  assert.match(PO, /const pnLines = collected\.length > 0 \? collected : null;/);
  assert.match(PO, /if \(!altLookup\.has\(alt\.key\)\) altLookup\.set/, "first writer wins — an exact key is never displaced");
});

test("matched and non-BOM rows are disjoint by construction", () => {
  // The invariant: a purchase line consumed by a BOM row — including one the
  // corrected join recovered — can never also appear as a non-BOM row.
  const PO = readFileSync(join(SRC, "lib", "po-detail.ts"), "utf8");
  assert.match(PO, /if \(pnLines\) for \(const l of pnLines\) usedLines\.add\(l\);/);
  assert.match(PO, /if \(usedLines\.has\(l\)\) continue;/);
});

test("join failures are classified before any keyword", () => {
  // A line a corrected join would attach to a BOM part is a defect to fix, not a
  // category to file it under — classifying it as "freight" because its description
  // mentions shipping would bury the thing worth finding.
  const REASON = readFileSync(join(SRC, "lib", "parts-match-reason.ts"), "utf8");
  const fn = REASON.slice(REASON.indexOf("export function classifyUnmatched"));
  assert.ok(fn.indexOf("if (recovered) return recovered;") < fn.indexOf("for (const rule of RULES)"));
});

test("credits keep their sign", () => {
  const REASON = readFileSync(join(SRC, "lib", "parts-match-reason.ts"), "utf8");
  assert.match(REASON, /if \(amount < 0\) return "credit";/);
  const PO = readFileSync(join(SRC, "lib", "po-detail.ts"), "utf8");
  assert.ok(!/Math\.max\(0,[^)]*totalPrice/.test(PO), "no clamping of a negative line");
});

// ── The two claim rules, and why they differ (2026-09-02) ───────────────────
//
// Verified across 35 active jobs: every one reconciles to the cent, on both the
// purchased and the GL-posted total. Getting there took two corrections that only
// showed up at that scale — 9 of the first 11 jobs passed, and the two that did not
// were failing for a reason no single-job check would have surfaced.

test("an exact-key claim is unconditional, so two rows sharing a part number both get a share", () => {
  const PO = readFileSync(join(SRC, "lib", "po-detail.ts"), "utf8");
  // Skipping an already-claimed line here left the second row with nothing while
  // the first still divided its money in two — half the part's cost vanishing.
  assert.match(PO, /const exactLines = \(lineIndex\.get\(normPn\(p\.pn\)\) \?\? \[\]\)\.filter\(\(l\) => !altClaimed\.has\(l\)\)/);
  assert.match(PO, /sumLines\(exactLines, f\) \/ shareOf\(p\.pn\) \+ sumLines\(altLines, f\)/);
});

test("a recovered line is not divided by a share — exactly one row owns it", () => {
  // `shareOf` is about rows entitled to the SAME exact key. A differently-spelled
  // line is claimed once, so dividing it sends the remainder nowhere.
  const PO = readFileSync(join(SRC, "lib", "po-detail.ts"), "utf8");
  assert.match(PO, /Exact lines take a share; recovered lines belong wholly to this row/);
});

test("an exact key cannot re-take a line an earlier part already recovered", () => {
  // The $8 on job 1104 and the $169 on 1125: a part whose alternate spelling was
  // recovered BEFORE the part holding the exact key was reached, so the same line
  // was counted twice. `altClaimed` is what makes the unconditional exact claim safe.
  const PO = readFileSync(join(SRC, "lib", "po-detail.ts"), "utf8");
  assert.match(PO, /const altClaimed = new Set<PartsCostLine>\(\);/);
  assert.match(PO, /altClaimed\.add\(l\);/);
});

// ── One round trip per selection, not one per job (2026-09-02) ─────────────
//
// Both the Parts Cost card and T&M fanned out at 6 concurrent Total ETO calls.
// Measured on the same work: 5,766ms across 239 jobs became 571ms; the card's own
// 40-job selection now resolves in 496ms. The 35-job reconciliation above was
// re-run against the new path and is unchanged — same lines, same totals.

test("the Parts Cost card reads the whole selection in one query", () => {
  const FIN = readFileSync(join(SRC, "lib", "parts-cost-financials.ts"), "utf8");
  assert.match(FIN, /getPartsCostForJobs\(jobs\.map\(\(j\) => j\.jobId\)\)/);
  assert.ok(!/mapWithConcurrency/.test(FIN), "the per-job fan-out is gone");
  assert.ok(!/getJobPartsCost\(/.test(FIN), "and so is the per-job call");
});

test("a failed batch read reports every job failed, never a confident zero", () => {
  // Per job this was partial — one job times out, `failedJobs` counts it. One query
  // is all-or-nothing, and an empty set with failedJobs 0 would render $0 as though
  // it were an answer, on a card people read as a budget position.
  const FIN = readFileSync(join(SRC, "lib", "parts-cost-financials.ts"), "utf8");
  assert.match(FIN, /const failedJobs = byJob \? 0 : jobs\.length;/);
  assert.match(FIN, /const lines: PartsCostLine\[\] = byJob \? jobs\.flatMap\(\(j\) => byJob\.get\(j\.jobId\) \?\? \[\]\) : \[\];/);
});

// ── Paging draws less, counts the same (2026-09-03) ─────────────────────────
//
// The Parts List pages at 50 rows, requested because job 1101 put 628 rows in one
// scroll container. The hazard is the one this file's footer already exists to
// prevent: a total that quietly covers only the visible page while the strip above
// it says 628. These guards pin the separation.
//
// Asserted against PROC, which has comments stripped — so every match below is on
// real code, not on a comment describing it.

test("the page slice is what renders; the totals still cover every filtered row", () => {
  assert.match(PROC, /const PARTS_PAGE_SIZE = 50;/);
  // Sorted first, then sliced — otherwise page 1 is the first 50 rows re-sorted
  // among themselves rather than the top of the sort.
  assert.match(PROC, /const pageParts = sortedParts\.slice\(pager\.from, pager\.to\)/);
  assert.match(PROC, /\{pageParts\.map\(\(p, i\) => \{/, "the tbody must render the page slice");

  // The column totals and the row counts must still reduce over `parts` — the whole
  // filtered set — never over the page.
  assert.match(PROC, /const tot = parts\.reduce\(/, "column totals stay over every filtered row");
  assert.match(
    PROC,
    /for \(const p of parts\) if \(!p\.nonBom\) bomRows\+\+;/,
    "row counts stay over every filtered row",
  );
  assert.ok(
    !/pageParts\.reduce\(/.test(PROC),
    "nothing may be summed from the page slice — that is the scope bug this footer exists to prevent",
  );
});

test("the footer says how many of the counted rows are actually drawn", () => {
  // Paging is a third scope on the strip, alongside "filtered" and "whole job", and
  // it has to be stated for the same reason: otherwise "628 rows" sits directly
  // above a table showing 50.
  assert.match(PROC, /on this page/);
  assert.match(PROC, /\{num\(pager\.from \+ 1\)\}–\{num\(pager\.to\)\}/);
});

test("the page resets when the row set changes underneath it", () => {
  // Filtering 628 rows down to 12 while sitting on page 4 would otherwise leave an
  // empty table and no obvious way back. The signature carries the filter count, the
  // sort and the scope chip — re-sorting makes the current page's contents arbitrary.
  assert.match(PROC, /function usePartsPage\(total: number, signature: string\)/);
  assert.match(PROC, /if \(seenSignature !== signature\) \{/);
  // Reset during render, not in an effect: `set-state-in-effect` is an error in this
  // repo's lint config, and an effect would paint the stale page for a frame first.
  assert.ok(!/useEffect\(\(\) => \{\s*setPage\(0\)/.test(PROC));
  // And the page is clamped, because `total` can shrink between renders.
  assert.match(PROC, /const current = Math\.min\(page, pageCount - 1\)/);
});
