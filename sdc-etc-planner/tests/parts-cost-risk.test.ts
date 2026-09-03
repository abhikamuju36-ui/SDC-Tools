import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { partsCostRisk, partsCostRiskTitle, suggestNewEtc, calcHoursLeft } from "../src/lib/etc";

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

const fragmentCells = (key: string) => {
  const start = ETC_PAGE.indexOf(`<Fragment key="${key}">`);
  assert.ok(start > -1, `no <Fragment key="${key}"> in the ETC page`);
  const body = withoutComments(ETC_PAGE.slice(start, ETC_PAGE.indexOf("</Fragment>", start)));
  // Comments must be stripped first: this file discusses `<td>` in prose, and counting
  // those was how the first version of this check reported a false mismatch.
  return (body.match(/<td\b/g)?.length ?? 0) + (body.match(/<PartsCostNewEtcCell\b/g)?.length ?? 0);
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
  // The no-entry placeholder maps the array, so it cannot drift.
  assert.match(ETC_PAGE, /PARTS_COST_SUB_COLUMNS\.map\(\(col, ci\)/);
});

test("the breakout renders an em dash when unknown, never a zero", () => {
  // null means "could not be read from Total ETO". A $0 would say "nothing
  // outstanding" — the opposite — on the two figures that seed the forecast.
  assert.match(ETC_PAGE, /breakout\?\.leftToInvoice == null \? "—" : currency\(breakout\.leftToInvoice\)/);
  assert.match(ETC_PAGE, /breakout\?\.leftToPurchase == null \? "—" : currency\(breakout\.leftToPurchase\)/);
});

test("a Total ETO outage costs two columns, not the month-end page", () => {
  // This is the page managers close the month on, and these columns are the only
  // upstream call on it. The fetch is awaited with a catch that degrades to nulls.
  assert.match(ETC_PAGE, /readPartsEtcBreakout\(/);
  assert.match(ETC_PAGE, /\.catch\(\(e\) => \{[\s\S]{0,200}return null;/);
});
