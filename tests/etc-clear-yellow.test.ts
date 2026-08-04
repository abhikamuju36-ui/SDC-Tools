import { test } from "node:test";
import assert from "node:assert/strict";
import { newEtcSeedText, isNewEtcCellDecided, isNewEtcClearable, type NewEtcCellState } from "../src/lib/etc";

// The yellow "needs attention" rule, and the set Clear ETC acts on.
//
// This rule used to live inline in EtcSectionCells, where the only consumer was a
// background colour. Clear ETC made it load-bearing: the button empties exactly the
// yellow cells, so if the rule the server applies and the rule that paints the cell
// ever diverge, the button clears something the manager cannot see — or misses
// something they can. Hence one shared function, and hence these tests.
//
// The cases that matter are the reopened-month ones. On a first-pass month a yellow
// cell is empty and there is nothing to clear; it is a REOPENED month where cells
// arrive carrying the figure they were submitted with, which is what Clear removes.

const cell = (over: Partial<NewEtcCellState> = {}): NewEtcCellState => ({
  priorEtc: 100,
  hoursWorked: 40,
  draft: null,
  confirmed: null,
  cleared: false,
  locked: false,
  monthComplete: true,
  ...over,
});

test("no hours worked is decided — New ETC just carries the prior forward", () => {
  const s = cell({ hoursWorked: 0 });
  // Nothing to decide, so never yellow and never clearable, even though the box
  // seeds with the carry-forward figure.
  assert.equal(newEtcSeedText(s), "100");
  assert.equal(isNewEtcCellDecided(s, newEtcSeedText(s)), true);
  assert.equal(isNewEtcClearable(s), false);
});

test("first-pass month: hours worked and nothing entered is yellow but NOT clearable", () => {
  const s = cell({ hoursWorked: 40, draft: null, confirmed: null });
  assert.equal(newEtcSeedText(s), "");
  assert.equal(isNewEtcCellDecided(s, ""), false); // yellow
  // Yellow, but empty — there is no value to remove. This is the normal state of
  // an in-progress month, and why Clear ETC reports 0 on one.
  assert.equal(isNewEtcClearable(s), false);
});

test("a typed-and-saved draft is decided, so Clear leaves it alone", () => {
  const s = cell({ draft: 55, confirmed: null });
  assert.equal(newEtcSeedText(s), "55");
  assert.equal(isNewEtcCellDecided(s, "55"), true);
  assert.equal(isNewEtcClearable(s), false);
});

test("reopened + untouched is yellow AND clearable — the case the button exists for", () => {
  // Seeds from the confirmed value because submittedAt is set; holding last
  // submission's figure is not an answer anybody has given this pass.
  const s = cell({ draft: null, confirmed: 96 });
  assert.equal(newEtcSeedText(s), "96");
  assert.equal(isNewEtcCellDecided(s, "96"), false);
  assert.equal(isNewEtcClearable(s), true);
});

test("reopened + a draft equal to the confirmed figure is still untouched", () => {
  // July 2026's real shape: the draft was written by the original submit pass, so
  // it matches newEtc. Presence alone would call this decided.
  const s = cell({ draft: 96, confirmed: 95.5 });
  assert.equal(newEtcSeedText(s), "96"); // hours seed rounds
  assert.equal(isNewEtcClearable(s), true);
});

test("reopened + genuinely retyped is decided", () => {
  const s = cell({ draft: 120, confirmed: 95.5 });
  assert.equal(isNewEtcCellDecided(s, "120"), true);
  assert.equal(isNewEtcClearable(s), false);
});

test("a locked month is never yellow — a closed book isn't asking anything", () => {
  const s = cell({ draft: null, confirmed: 96, locked: true });
  assert.equal(isNewEtcCellDecided(s, "96"), true);
  assert.equal(isNewEtcClearable(s), false);
});

test("cleared beats confirmed — the whole reason newEtcClearedAt exists", () => {
  // Nulling the draft alone would re-seed from `confirmed` and the clear would look
  // like it never happened.
  const s = cell({ draft: null, confirmed: 96, cleared: true });
  assert.equal(newEtcSeedText(s), "");
  // Still yellow — that is the point, so the grid reads as a checklist.
  assert.equal(isNewEtcCellDecided(s, ""), false);
  // And no longer clearable: nothing left in it. Clear ETC is idempotent.
  assert.equal(isNewEtcClearable(s), false);
});

test("entering a value after a clear wins over the cleared marker", () => {
  const s = cell({ draft: 70, confirmed: 96, cleared: true });
  assert.equal(newEtcSeedText(s), "70");
  assert.equal(isNewEtcCellDecided(s, "70"), true);
});

// ── Zero hours worked always shows a figure ─────────────────────────────────
// 2026-08-03, by request. These cells used to render blank, which left stretches of
// the grid at Prior 0 / Worked 0 / Hours Left 0 with an empty New ETC and Diff,
// reading as missing data. They were blanked because a literal "0" made ~350
// unquoted sections post a value and Submit timed out creating them all — now
// blocked at the source by parseNewEtcCreateFields dropping a 0.

test("a section with no row yet shows 0 rather than a blank box", () => {
  // Prior 0, Worked 0 — the carry-forward IS 0, and it is shown.
  const s = cell({ hoursWorked: 0, priorEtc: 0 });
  assert.equal(newEtcSeedText(s), "0");
  // Still decided (no hours worked = no decision asked for), so it is grey rather
  // than a flood of ~350 new yellow cells, and Clear ETC ignores it.
  assert.equal(isNewEtcCellDecided(s, "0"), true);
  assert.equal(isNewEtcClearable(s), false);
});

test("a ZERO carry-forward shows even mid-month", () => {
  // monthComplete guards against a partial figure looking final; 0 cannot.
  const s = cell({ hoursWorked: 0, priorEtc: 0, monthComplete: false });
  assert.equal(newEtcSeedText(s), "0");
  assert.equal(isNewEtcCellDecided(s, "0"), true);
});

test("a NON-zero carry-forward still waits for the month's actuals", () => {
  // Prior 100 mid-month is a real figure, and showing it before the hours are in
  // would state a plan the month has not finished measuring.
  const s = cell({ hoursWorked: 0, priorEtc: 100, monthComplete: false });
  assert.equal(newEtcSeedText(s), "");
  // Still decided: no hours worked means no decision is being asked for.
  assert.equal(isNewEtcCellDecided(s, ""), true);
});

test("a complete month fills the non-zero carry-forward", () => {
  const s = cell({ hoursWorked: 0, priorEtc: 100, monthComplete: true });
  assert.equal(newEtcSeedText(s), "100");
});

// ── Parts Cost is money, and keeps its cents ────────────────────────────────
// The hours seed rounds to whole deliberately (display == submission). Applying
// that to dollars would drop cents from what a no-changes resubmit writes, so the
// column declares its precision.

test("exact precision keeps cents in the seed", () => {
  const s = cell({ draft: 50000.25, confirmed: null, precision: "exact" });
  assert.equal(newEtcSeedText(s), "50000.25");
});

// ── Parts Cost answers the same question, in dollars ────────────────────────
// Requested 2026-08-04: "do not automatically fill the New ETC cells when there is
// a value in the Money Spent Month column — highlight those cells in yellow so
// managers can enter the values manually, just like they do for the hours cells."
//
// That reverses the 2026-08-03 request that the column ALWAYS show a figure (which
// this block used to assert, and which reopenAsksAgain:false implemented). The
// column is built with the DEFAULT flags now, so the only difference left from an
// hours cell is `precision` — dollars keep their cents.
const partsCell = (over: Partial<NewEtcCellState> = {}): NewEtcCellState =>
  cell({ precision: "exact", ...over });

test("Parts Cost with money spent and nothing entered is YELLOW and blank", () => {
  // The requirement, stated directly: spend but no decision means the manager is
  // asked, and nothing is put in the box for them.
  const s = partsCell({ hoursWorked: 2604.43, draft: null, confirmed: null });
  assert.equal(newEtcSeedText(s), "");
  assert.equal(isNewEtcCellDecided(s, ""), false);
});

test("Parts Cost reopened + untouched is asked again, like an hours cell", () => {
  const s = partsCell({ hoursWorked: 2604.43, draft: null, confirmed: 12395.57 });
  // It still ARRIVES holding last submission's figure — that is what Clear ETC is
  // for, and the same thing an hours cell does on a reopened month...
  assert.equal(newEtcSeedText(s), "12395.57");
  // ...but holding it is not an answer, so it reads as awaiting one and is clearable.
  assert.equal(isNewEtcCellDecided(s, "12395.57"), false);
  assert.equal(isNewEtcClearable(s), true);
});

test("Parts Cost stops being yellow the moment a different figure is typed", () => {
  // "Once a value is entered, the yellow highlight should disappear." Judged from
  // the LIVE text, so it happens as the manager types — no save required.
  const s = partsCell({ hoursWorked: 2604.43, draft: null, confirmed: 12395.57 });
  assert.equal(isNewEtcCellDecided(s, "9000"), true);
  // Cents count as a change: dollars are compared at "exact" precision.
  assert.equal(isNewEtcCellDecided(s, "12395.58"), true);
});

test("a Parts Cost figure the manager actually saved is decided and never cleared", () => {
  const s = partsCell({ hoursWorked: 500, draft: 4200, confirmed: 5819.03 });
  assert.equal(newEtcSeedText(s), "4200");
  assert.equal(isNewEtcCellDecided(s, "4200"), true);
  assert.equal(isNewEtcClearable(s), false);
});

test("Parts Cost with NO money spent still carries forward automatically", () => {
  // The half of the old behaviour that stays: no spend, no question. The balance
  // carries and the cell reads as settled, so Clear ETC leaves it alone.
  const s = partsCell({ hoursWorked: 0, priorEtc: 8600, confirmed: 500 });
  assert.equal(isNewEtcCellDecided(s, newEtcSeedText(s)), true);
  assert.equal(isNewEtcClearable(s), false);
});

test("hours and Parts Cost now give the SAME verdict on the same state", () => {
  // This used to assert the opposite — "identical state, opposite verdicts". The
  // asymmetry is gone; only the cents in the seed text distinguish the columns.
  const hours = cell({ draft: null, confirmed: 96 });
  const parts = partsCell({ draft: null, confirmed: 96 });
  assert.equal(isNewEtcClearable(hours), true);
  assert.equal(isNewEtcClearable(parts), true);
});
