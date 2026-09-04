import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { partsCostRisk, partsCostRiskTitle, suggestNewEtc, calcHoursLeft, redrivenDraft } from "../src/lib/etc";
import { isDerivedPartsDraft } from "../src/lib/parts-breakout-scope";
import { PARTS_COST_SECTION } from "../src/lib/sections";

// ── The Parts Cost under-planning warning (2026-09-03) ──────────────────────
//
// "If there is still positive parts cost left to invoice and the manager enters a
// New ETC below that amount, flag it." The rule is one pure function so the
// server's first paint and the client's live repaint cannot disagree; these tests
// are what make the edge cases (the reported overspent row, a blank cell, an exact
// match) claims rather than hopes.

const decided = (moneyLeft: number, newEtc: number) => partsCostRisk({ moneyLeft, newEtc, decided: true });

test("the headline case: entered ETC below the money left is flagged", () => {
  const r = decided(10_000, 7_500);
  assert.equal(r.atRisk, true);
  assert.equal(r.shortfall, 2_500);
});

test("covering it exactly is right, not marginal", () => {
  // Strict comparison: entering exactly Money Left covers it.
  assert.equal(decided(10_000, 10_000).atRisk, false);
  assert.equal(decided(10_000, 12_000).atRisk, false);
});

test("a blank cell is an unanswered question, not a wrong answer", () => {
  // It already has its own yellow "needs attention" state. Red here would flag
  // every unplanned row on load, and the manager could not tell "you got this
  // wrong" from "you haven't done this yet".
  assert.equal(partsCostRisk({ moneyLeft: 10_000, newEtc: 0, decided: false }).atRisk, false);
  assert.equal(partsCostRisk({ moneyLeft: 10_000, newEtc: 7_500, decided: false }).atRisk, false);
});

test("an overspent row is never flagged — the reported example", () => {
  // Prior $1,653, Spent $3,357, so Money Left is -$1,704 and New ETC is $0.
  // Every value including 0 is "greater than" -1,704; there is no remaining
  // liability to be short of. Flagging it would paint a correct row red.
  const moneyLeft = calcHoursLeft(1_653, 3_357);
  assert.equal(moneyLeft, -1_704);
  assert.equal(decided(moneyLeft, 0).atRisk, false);
  // Not even a value below it, which is the case a naive `newEtc < moneyLeft`
  // would still catch.
  assert.equal(decided(moneyLeft, -5_000).atRisk, false);
});

test("a fully-invoiced row is not flagged by a zero ETC", () => {
  // Money Left $0 and New ETC $0 is exactly right.
  assert.equal(decided(0, 0).atRisk, false);
  assert.equal(decided(0, 100).atRisk, false);
});

test("a month with NO spend carries forward and cannot flag itself", () => {
  // The blank-but-decided case. isNewEtcCellDecided treats spend 0 as answered
  // (the balance carries forward automatically), so `decided` is true with an empty
  // box — and the figure the cell publishes is then the SUGGESTION. This only stays
  // un-flagged because suggestNewEtc returns exactly Money Left when spend is 0, so
  // the gate is arithmetic rather than a special case. If that ever stops being
  // true, every no-spend row on the grid turns red, so it is pinned here.
  const prior = 25_000;
  const spent = 0;
  const moneyLeft = calcHoursLeft(prior, spent);
  const suggested = suggestNewEtc(prior, spent);
  assert.equal(suggested, moneyLeft, "suggestNewEtc must equal Money Left at zero spend, or no-spend rows flag");
  assert.equal(decided(moneyLeft, suggested).atRisk, false);
});

test("cents are respected — no tolerance band", () => {
  // Parts Cost is precision "exact" (money, unlike the hours columns), so a small
  // shortfall is real and must not be rounded away: the cell would then disagree
  // with the Diff printed beside it.
  const r = decided(10_000, 9_999.99);
  assert.equal(r.atRisk, true);
  assert.equal(r.shortfall, 0.01);
});

test("bad data reads as bad data, not as a pass", () => {
  // Both figures come from Number() over a form value or a Prisma Decimal. NaN
  // comparisons are all false, so without the explicit guard a NaN would look
  // exactly like "not at risk".
  assert.equal(partsCostRisk({ moneyLeft: NaN, newEtc: 7_500, decided: true }).atRisk, false);
  assert.equal(partsCostRisk({ moneyLeft: 10_000, newEtc: NaN, decided: true }).atRisk, false);
  assert.equal(partsCostRisk({ moneyLeft: 10_000, newEtc: Infinity, decided: true }).atRisk, false);
});

test("shortfall is 0 whenever there is no risk, so callers can print it unconditionally", () => {
  for (const r of [decided(10_000, 10_000), decided(-500, 0), decided(0, 0), partsCostRisk({ moneyLeft: 1, newEtc: 0, decided: false })]) {
    assert.equal(r.shortfall, 0);
  }
});

test("the tooltip states the rule and the arithmetic behind it", () => {
  const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
  const t = partsCostRiskTitle(10_000, 7_500, 2_500, usd);
  assert.match(t, /New ETC is lower than the remaining parts cost to be invoiced/);
  assert.match(t, /Money Left: \$10,000/);
  assert.match(t, /New ETC: \$7,500/);
  assert.match(t, /Shortfall: \$2,500/);
});

// ── Scope: the four Parts Cost cells and nothing else ───────────────────────

test("the warning is wired to the Parts Cost cells only, not the hours columns", () => {
  // Requirement 7: "Other hours/department columns are not affected." The hours
  // cells are rendered by EtcSectionCells; it must know nothing about this rule.
  const sectionCells = readFileSync(join(process.cwd(), "src", "components", "EtcSectionCells.tsx"), "utf8");
  assert.ok(
    !/partsCostRisk|parts-risk/.test(sectionCells),
    "the hours cells must not consult the Parts Cost risk rule",
  );
});

// ── The Parts Cost column set and its cells must stay in step ───────────────
//
// Added 2026-09-03 with the Left to Invoice / Left to Purchase columns. The grid is
// one wide table with hand-written body cells and a `colSpan` computed from the
// column array, so adding a column in one place and not the other shifts every job
// row by one column against its own headers — silent, and wrong in a way that looks
// like a data bug rather than a layout one.

const ETC_PAGE = readFileSync(join(process.cwd(), "src", "app", "(app)", "etc", "page.tsx"), "utf8");

const withoutComments = (t: string) =>
  t
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/** How many of that row's cells sit inside a `{showBreakout && (<>…</>)}` fragment. */
const gatedCellsIn = (key: string) => {
  const start = ETC_PAGE.indexOf(`<Fragment key="${key}">`);
  assert.ok(start > -1, `no <Fragment key="${key}"> in the ETC page`);
  const body = withoutComments(ETC_PAGE.slice(start, ETC_PAGE.indexOf("</Fragment>", start)));
  const gate = /\{showBreakout && \(\s*<>([\s\S]*?)<\/>\s*\)\}/.exec(body);
  if (!gate) return 0;
  return (gate[1].match(/<td[\s>]/g)?.length ?? 0) + (gate[1].match(/<PartsBreakoutCell[\s>]/g)?.length ?? 0);
};

const fragmentCells = (key: string) => {
  const start = ETC_PAGE.indexOf(`<Fragment key="${key}">`);
  assert.ok(start > -1, `no <Fragment key="${key}"> in the ETC page`);
  const body = withoutComments(ETC_PAGE.slice(start, ETC_PAGE.indexOf("</Fragment>", start)));
  // Comments must be stripped first: this file discusses `<td>` in prose, and counting
  // those was how the first version of this check reported a false mismatch.
  return (
    (body.match(/<td\b/g)?.length ?? 0) +
    (body.match(/<PartsCostNewEtcCell\b/g)?.length ?? 0) +
    // The breakout columns are client components too, not <td>s — they are the two
    // cells a manager types into (2026-09-03).
    (body.match(/<PartsBreakoutCell\b/g)?.length ?? 0)
  );
};

test("the Parts Cost columns include the New ETC breakout, in reading order", () => {
  const declared = /const PARTS_COST_SUB_COLUMNS = \[([\s\S]*?)\] as const;/.exec(ETC_PAGE);
  assert.ok(declared, "PARTS_COST_SUB_COLUMNS changed shape");
  const cols = [...declared[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(cols, [
    "Prior ETC",
    "Money Spent Month",
    "Money Left",
    "Left to Invoice",
    "Left to Purchase",
    "New ETC",
    "Diff",
  ]);
  // The two new ones sit immediately before New ETC, so the row reads left-to-right
  // as the sum it is: Left to Invoice + Left to Purchase = the New ETC seed.
  assert.equal(cols.indexOf("Left to Purchase") + 1, cols.indexOf("New ETC"));
});

test("every Parts Cost row renders exactly one cell per declared column", () => {
  const declared = /const PARTS_COST_SUB_COLUMNS = \[([\s\S]*?)\] as const;/.exec(ETC_PAGE)!;
  const count = [...declared[1].matchAll(/"([^"]+)"/g)].length;
  assert.equal(fragmentCells("parts-cost"), count, "a job row is out of step with its headers");
  assert.equal(fragmentCells("parts-cost-total"), count, "the grand-total row is out of step");
  // The no-entry placeholder maps the RENDERED list, so it cannot drift. That is
  // `partsCostCols`, not the full constant — see the month test below.
  assert.match(ETC_PAGE, /partsCostCols\.map\(\(col, ci\)/);
});

test("before August 2026 the Parts Cost rows shrink by exactly the two breakout columns", () => {
  // The constant above is the SUPERSET of columns. What renders is `partsCostCols`,
  // which drops Left to Invoice and Left to Purchase on any month before 2026-08 (see
  // lib/parts-breakout-scope.ts). So the header can be seven or five wide, and every
  // row has to shrink WITH it — a body one cell wider than its header shifts every
  // Parts Cost column after the gap, which is wrong without looking broken.
  const declared = /const PARTS_COST_SUB_COLUMNS = \[([\s\S]*?)\] as const;/.exec(ETC_PAGE)!;
  const superset = [...declared[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  // The derivation drops exactly the two, and nothing else.
  const dropped = superset.filter((c) => !["Left to Invoice", "Left to Purchase"].includes(c));
  assert.equal(dropped.length, superset.length - 2, "the derivation must remove exactly two columns");
  assert.match(
    ETC_PAGE,
    /PARTS_COST_SUB_COLUMNS\.filter\(\(c\) => c !== "Left to Invoice" && c !== "Left to Purchase"\)/,
    "the pre-August list must be derived from the constant, not typed out again",
  );

  // And each row hides exactly two cells behind the same flag the header uses, so the
  // five-column month is the layout every month had before this feature existed.
  for (const key of ["parts-cost", "parts-cost-total"]) {
    const gated = gatedCellsIn(key);
    assert.equal(gated, 2, `the ${key} row hides ${gated} cells behind showBreakout, not 2`);
    assert.equal(fragmentCells(key) - gated, superset.length - 2, `the ${key} row's pre-August width is wrong`);
  }
});

test("both breakout columns are typed cells, and neither is ever seeded", () => {
  // Requested 2026-09-03: both are editable and start blank, with nothing populating
  // them automatically. The test names the SEED rather than the emptiness — a cell can
  // look empty by accident, but a seed is always deliberate.
  //
  // Left to Purchase was the explicit request. Left to Invoice followed: a live,
  // unstored seed cannot coexist with New ETC being the sum of these two, because a
  // save carrying only the other half derives New ETC from 0 + that half. The upstream
  // figure lives on the tooltip instead.
  assert.match(ETC_PAGE, /<PartsBreakoutCell[\s\S]{0,400}?which="invoice"/);
  assert.match(ETC_PAGE, /<PartsBreakoutCell[\s\S]{0,400}?which="purchase"/);
  const fromStorageOrNothing = [
    /const leftToInvoiceValue =\s*partsCostEntry\.leftToInvoice != null\s*[?] round2\(Number\(partsCostEntry\.leftToInvoice\)\)\s*: carriedLeftToInvoice;/,
    /const leftToPurchaseValue =\s*partsCostEntry\.leftToPurchase != null \? round2\(Number\(partsCostEntry\.leftToPurchase\)\) : null;/,
  ];
  for (const re of fromStorageOrNothing) {
    assert.match(ETC_PAGE, re, "a breakout cell may come from storage or from nothing — never from an upstream seed");
  }
  // The one thing Left to Invoice MAY fall back to is a New ETC somebody typed before
  // these columns existed — a stored figure, and only while BOTH halves are empty. The
  // save applies the same rule against the same fields, so the cell and the write
  // cannot form different opinions about what that cell holds.
  assert.match(
    ETC_PAGE,
    /partsCostEntry\.leftToInvoice == null &&\s*partsCostEntry\.leftToPurchase == null &&\s*partsCostEntry\.newEtcDraft != null/,
    "the page must carry a pre-existing New ETC into Left to Invoice",
  );
  assert.match(
    readFileSync(join(process.cwd(), "src", "lib", "etc-actions.ts"), "utf8"),
    /storedInvoice === null && storedPurchase === null && entry\.newEtcDraft != null/,
    "the save must apply the same carry rule as the page",
  );
  // And nothing upstream computes such a figure any more: the BOM half that used to
  // fill this column was removed with this change.
  const breakoutLib = readFileSync(join(process.cwd(), "src", "lib", "parts-etc-breakout.ts"), "utf8");
  // The IMPORTS, not the prose: the file explains at length what it used to do, and
  // matching on the names alone would fail on its own history.
  assert.ok(
    !/^import .*(job-bom|po-detail)/m.test(breakoutLib),
    "nothing may compute a Left to Purchase figure",
  );
  assert.ok(!/leftToPurchase/.test(breakoutLib.replace(/\/\/.*$/gm, "")), "no upstream Left to Purchase value");
});

test("New ETC is the sum of the two typed cells, and is not itself typed", () => {
  // One authoritative value, in both halves of the app: the cell renders as TEXT from
  // the live breakout store, and the SERVER derives what it stores rather than
  // trusting the figure the browser posts.
  const cell = readFileSync(join(process.cwd(), "src", "components", "PartsCostNewEtcCell.tsx"), "utf8");
  assert.match(cell, /readPartsBreakoutSum\(jobId\)/);
  assert.match(cell, /\{derived \? \(/, "a derived cell must render text, not an input");
  assert.match(ETC_PAGE, /derived=\{showBreakout\}/);

  const actions = readFileSync(join(process.cwd(), "src", "lib", "etc-actions.ts"), "utf8");
  assert.match(actions, /round2\(\(next\.invoice \?\? 0\) \+ \(next\.purchase \?\? 0\)\)/);
  assert.match(
    actions,
    /if \(breakoutInScope && entry\.section === PARTS_COST_SECTION\) \{\s*handlePartsBreakoutEntry\(entry\);/,
    "a breakout month's Parts Cost New ETC must never be taken from the posted field",
  );
});

test("a Total ETO outage costs two columns, not the month-end page", () => {
  // This is the page managers close the month on, and these columns are the only
  // upstream call on it. The fetch is awaited with a catch that degrades to nulls.
  assert.match(ETC_PAGE, /readPartsEtcBreakout\(/);
  assert.match(ETC_PAGE, /\.catch\(\(e\) => \{[\s\S]{0,200}return null;/);
});

// ── The derived draft may not be redriven ────────────────────────────────────
//
// On a breakout month `newEtcDraft` is not a typed figure, it is
// `leftToInvoice + leftToPurchase`. Everything downstream — the submission, the
// export, next month's Prior ETC — reads that column, while the grid renders the sum
// of the two halves. The moment a writer moves one without the other they disagree,
// and nothing on screen says so.

test("isDerivedPartsDraft names exactly the rows whose New ETC is a sum", () => {
  // Parts Cost from August 2026 on, and nothing else. Hours sections type their New
  // ETC on every month, so redriving theirs stays correct.
  assert.equal(isDerivedPartsDraft("2026-08", PARTS_COST_SECTION), true);
  assert.equal(isDerivedPartsDraft("2026-09", PARTS_COST_SECTION), true);
  assert.equal(isDerivedPartsDraft("2026-07", PARTS_COST_SECTION), false);
  assert.equal(isDerivedPartsDraft("2026-08", "ELECTRICAL_ENGINEERING"), false);
  // Unparseable month answers false for the same reason showsPartsBreakout does: the
  // safe direction is the behaviour every month had before the columns existed.
  assert.equal(isDerivedPartsDraft(null, PARTS_COST_SECTION), false);
  assert.equal(isDerivedPartsDraft("garbage", PARTS_COST_SECTION), false);
});

test("the guard blocks the redrive that would break the invariant", () => {
  // The collision is not exotic — it fires precisely when the halves add up to the
  // figure the grid suggested, which is what a manager who agreed with the suggestion
  // typed. Here: Left to Invoice 2,500 + Left to Purchase 500 = 3,000, and 3,000 is
  // also suggestNewEtc(oldPrior=10,000, worked=7,000).
  const oldPriorEtc = 10_000;
  const hoursWorked = 7_000;
  const invoice = 2_500;
  const purchase = 500;
  const storedDraft = invoice + purchase;
  assert.equal(storedDraft, suggestNewEtc(oldPriorEtc, hoursWorked), "the premise of this test");

  // Prior ETC moves — a later parts sync, a cascade, a reopened upstream month.
  const newPriorEtc = 12_000;
  const unguarded = redrivenDraft({ draft: storedDraft, oldPriorEtc, newPriorEtc, hoursWorked });
  assert.notEqual(unguarded, invoice + purchase, "without the guard the draft stops being the sum");

  const guarded = isDerivedPartsDraft("2026-08", PARTS_COST_SECTION)
    ? storedDraft
    : redrivenDraft({ draft: storedDraft, oldPriorEtc, newPriorEtc, hoursWorked });
  assert.equal(guarded, invoice + purchase, "New ETC must stay equal to the two halves beside it");

  // And the same row one month earlier, where the draft IS typed, still moves.
  const july = isDerivedPartsDraft("2026-07", PARTS_COST_SECTION)
    ? storedDraft
    : redrivenDraft({ draft: storedDraft, oldPriorEtc, newPriorEtc, hoursWorked });
  assert.equal(july, unguarded, "a typed draft that echoed the old suggestion still follows Prior ETC");
});

test("every redrivenDraft caller is guarded — including ones not written yet", () => {
  // The point of scanning rather than naming the two known files: this invariant broke
  // because two writers existed that nobody checked against it, and a third would break
  // it the same way. A new call site fails this test until it decides about derived
  // rows.
  const libDir = join(process.cwd(), "src", "lib");
  const callers = readdirSync(libDir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ file: f, src: readFileSync(join(libDir, f), "utf8") }))
    // etc.ts DEFINES redrivenDraft; parts-breakout-scope.ts only discusses it in prose.
    .filter(({ file, src }) => file !== "etc.ts" && file !== "parts-breakout-scope.ts" && /\bredrivenDraft\(/.test(src));

  assert.ok(callers.length >= 2, `expected the known writers, found ${callers.map((c) => c.file).join(", ")}`);
  for (const { file, src } of callers) {
    assert.match(
      src,
      /isDerivedPartsDraft\(/,
      `${file} rewrites newEtcDraft but never asks whether the row's draft is derived from ` +
        `Left to Invoice + Left to Purchase — see lib/parts-breakout-scope.ts`,
    );
  }
});
