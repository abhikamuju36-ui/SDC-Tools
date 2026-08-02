import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcHoursLeft,
  suggestNewEtc,
  round2,
  isMonthLocked,
  prevMonth,
  nextMonth,
  isValidMonth,
  workingDaysInMonth,
  hasPublishedHistory,
  groupStandardFeesRows,
  isSafeForLiveEtcSync,
  isNewEtcDecided,
  effectiveNewEtc,
  newEtcDiff,
  latestPriorEtcByKey,
} from "../src/lib/etc";

test("calcHoursLeft: prior minus worked, may go negative", () => {
  assert.equal(calcHoursLeft(100, 40), 60);
  assert.equal(calcHoursLeft(10, 25), -15);
  assert.equal(calcHoursLeft(0, 0), 0);
});

test("suggestNewEtc: carry-forward rule when no hours worked", () => {
  // Dan's rule: no hours worked ⇒ no progress ⇒ New ETC = Prior ETC.
  assert.equal(suggestNewEtc(80, 0), 80);
  assert.equal(suggestNewEtc(0, 0), 0);
});

test("suggestNewEtc: subtracts worked hours, clamped at zero", () => {
  assert.equal(suggestNewEtc(100, 30), 70);
  assert.equal(suggestNewEtc(20, 50), 0); // overrun never suggests negative
});

test("round2: rounds to cents/hundredths", () => {
  assert.equal(round2(1.005 * 100), 100.5);
  assert.equal(round2(3.14159), 3.14);
  assert.equal(round2(2.675), 2.68); // 2.675 * 100 = 267.50000000000003 → 268
});

test("prevMonth/nextMonth: adjacent months incl. year rollover", () => {
  assert.equal(prevMonth("2026-06"), "2026-05");
  assert.equal(prevMonth("2026-01"), "2025-12");
  assert.equal(nextMonth("2026-06"), "2026-07");
  assert.equal(nextMonth("2026-12"), "2027-01");
  assert.equal(nextMonth(prevMonth("2026-01")), "2026-01"); // round-trip
});

test("isValidMonth: accepts YYYY-MM, rejects garbage", () => {
  assert.equal(isValidMonth("2026-06"), true);
  assert.equal(isValidMonth("2026-12"), true);
  assert.equal(isValidMonth("2026-13"), false);
  assert.equal(isValidMonth("2026-00"), false);
  assert.equal(isValidMonth("2026-6"), false);
  assert.equal(isValidMonth("banana"), false);
  assert.equal(isValidMonth(""), false);
});

test("workingDaysInMonth: weekday count, matches the report's Working Days card", () => {
  assert.equal(workingDaysInMonth("2026-05"), 21); // the report's card shows 21 for the May 2026 period
  assert.equal(workingDaysInMonth("2026-06"), 22); // June 2026 starts on a Monday, 30 days
  assert.equal(workingDaysInMonth("2026-07"), 23);
  assert.equal(workingDaysInMonth("2026-02"), 20); // non-leap February
});

test("isMonthLocked: locked only when non-empty and fully confirmed", () => {
  assert.equal(isMonthLocked([]), false); // never-started month is NOT locked
  assert.equal(isMonthLocked([{ needsReview: true }]), false);
  assert.equal(isMonthLocked([{ needsReview: false }, { needsReview: true }]), false);
  assert.equal(isMonthLocked([{ needsReview: false }, { needsReview: false }]), true);
});

// Regression coverage for the 2026-07-14 fix: a month locked in the app via a
// premature/live submission must not silently stay wrong forever once Power
// BI's real historical archive shows up for it (see sync-etc-history.ts).
test("hasPublishedHistory: true only when at least one row has a real (non-null) value", () => {
  assert.equal(hasPublishedHistory([]), false); // no period rows at all yet
  assert.equal(hasPublishedHistory([{ NewEtc: null }, { NewEtc: null }]), false); // period exists, still unarchived
  assert.equal(hasPublishedHistory([{ NewEtc: null }, { NewEtc: 100 }]), true); // archive has landed
  assert.equal(hasPublishedHistory([{ NewEtc: 0 }]), true); // a real zero still counts as published
});

test("groupStandardFeesRows: routes owned-month rows to ownedWithHistoryNow instead of rowsByMonth", () => {
  type Row = { key: number; month: string };
  const rows: Row[] = [
    { key: 1, month: "2026-04" }, // owned, archive present -> flagged
    { key: 2, month: "2026-04" },
    { key: 3, month: "2026-05" }, // not owned -> grouped normally
    { key: 4, month: "2026-06" }, // owned, archive present -> flagged (dedup across rows)
    { key: 5, month: "2026-06" },
  ];
  const { rowsByMonth, ownedWithHistoryNow, ownedRowsByMonth } = groupStandardFeesRows(rows, (r) => r.month, new Set(["2026-04", "2026-06"]));

  assert.deepEqual(ownedWithHistoryNow, ["2026-04", "2026-06"]); // deduped, one entry per owned month
  assert.deepEqual([...rowsByMonth.keys()], ["2026-05"]); // owned months never make it into rowsByMonth
  assert.equal(rowsByMonth.get("2026-05")?.length, 1);
  // owned rows aren't just flagged and discarded — they're preserved so the
  // caller can reconcile their non-decision fact fields against Power BI.
  assert.deepEqual([...ownedRowsByMonth.keys()].sort(), ["2026-04", "2026-06"]);
  assert.equal(ownedRowsByMonth.get("2026-04")?.length, 2);
  assert.equal(ownedRowsByMonth.get("2026-06")?.length, 2);
});

test("groupStandardFeesRows: an owned month with no Power BI rows at all is never flagged", () => {
  // Mirrors the real June 2026 case: the period doesn't exist in Power BI's
  // archive yet, so it must never falsely trigger the stale-data warning.
  type Row = { month: string };
  const rows: Row[] = [{ month: "2026-04" }];
  const { ownedWithHistoryNow } = groupStandardFeesRows(rows, (r) => r.month, new Set(["2026-04", "2026-06"]));
  assert.deepEqual(ownedWithHistoryNow, ["2026-04"]);
});

test("groupStandardFeesRows: rows with no resolvable month are dropped, not grouped under undefined", () => {
  type Row = { periodKey: number };
  const rows: Row[] = [{ periodKey: 999 }]; // unmapped period key
  const { rowsByMonth, ownedWithHistoryNow } = groupStandardFeesRows(rows, () => undefined, new Set());
  assert.equal(rowsByMonth.size, 0);
  assert.deepEqual(ownedWithHistoryNow, []);
});

// Regression coverage for the 2026-07-14 Run Report corruption bug: proven
// live by reopening a corrected historical month and running the real sync —
// 42 real entries were deleted, 62 wrong ones were injected. This is the
// pure decision logic behind the fix in etc-actions.ts's assertCurrentEtcMonth.
test("isSafeForLiveEtcSync: no month started yet — anything goes", () => {
  assert.equal(isSafeForLiveEtcSync("2026-07", null), true);
});

test("isSafeForLiveEtcSync: refreshing the existing latest month is safe", () => {
  assert.equal(isSafeForLiveEtcSync("2026-06", "2026-06"), true);
});

test("isSafeForLiveEtcSync: starting the very next month is safe (it has no entries yet, so was never 'latest')", () => {
  assert.equal(isSafeForLiveEtcSync("2026-07", "2026-06"), true);
});

test("isSafeForLiveEtcSync: any older month is unsafe, even the one right before latest", () => {
  assert.equal(isSafeForLiveEtcSync("2026-05", "2026-06"), false);
  assert.equal(isSafeForLiveEtcSync("2026-04", "2026-06"), false);
});

test("isSafeForLiveEtcSync: a month further in the future than 'next' is unsafe too", () => {
  assert.equal(isSafeForLiveEtcSync("2026-08", "2026-06"), false);
});

// ── Diff is LIVE on every cell (2026-08-02) ─────────────────────────────────
//
// This reverses the 2026-07-31 rule, which returned null for any cell a manager
// hadn't typed into. That rule was added because the totals showed a large
// overrun off almost no decided cells, and it was read as phantom. Requested
// back by the user: the Diff column was blank across most of the grid for most
// of the month, which hid the one thing it exists to show.
//
// The mechanism is unchanged and worth restating, because it is what makes the
// live number safe to read. An untouched cell compares against the SUGGESTION:
//   • worked 0                  -> suggestion is Prior, Hours Left is Prior  -> 0
//   • worked, hours still left  -> suggestion IS Hours Left                  -> 0
//   • worked PAST Prior ETC     -> suggestion clamps at 0, Hours Left is
//                                  negative                                  -> the overrun
// So an untouched cell is silent unless the section is genuinely overspent.
// Those hours are booked whether or not anyone has typed a New ETC.

test("newEtcDiff: an untouched cell with hours left reads 0, not a variance", () => {
  // Prior 100, worked 40 -> 60 left, and the suggestion is also 60.
  assert.equal(newEtcDiff({ needsReview: true, newEtcDraft: null, newEtc: 0, priorEtc: 100, hoursWorked: 40 }), 0);
});

test("newEtcDiff: an untouched cell with NO hours worked reads 0", () => {
  // The carry-forward case: suggestion is Prior, so nothing has moved.
  assert.equal(newEtcDiff({ needsReview: true, newEtcDraft: null, newEtc: 0, priorEtc: 100, hoursWorked: 0 }), 0);
});

test("newEtcDiff: an untouched but OVERSPENT cell reports the overrun", () => {
  // Prior 20, worked 50 -> 30 hours past the estimate. The suggestion clamps at
  // 0 (a plan can't be negative) while Hours Left is -30, so the gap IS the
  // overrun. This is the case the old rule suppressed, and the case the column
  // most needs to surface.
  assert.equal(newEtcDiff({ needsReview: true, newEtcDraft: null, newEtc: 0, priorEtc: 20, hoursWorked: 50 }), -30);
});

test("newEtcDiff: never returns null", () => {
  // The column and every total now render it unconditionally, so a null here
  // would print as NaN rather than as a dash.
  const cases = [
    { needsReview: true, newEtcDraft: null, newEtc: 0, priorEtc: 0, hoursWorked: 0 },
    { needsReview: true, newEtcDraft: null, newEtc: 0, priorEtc: 20, hoursWorked: 50 },
    { needsReview: false, newEtcDraft: null, newEtc: 5, priorEtc: 20, hoursWorked: 5 },
  ];
  for (const c of cases) assert.equal(typeof newEtcDiff(c), "number");
});

test("newEtcDiff: a saved draft is a decision, and is compared", () => {
  // Prior 100, worked 40 -> 60 left; the manager says 80, so 20 over.
  assert.equal(newEtcDiff({ needsReview: true, newEtcDraft: 80, newEtc: 0, priorEtc: 100, hoursWorked: 40 }), -20);
});

test("newEtcDiff: a submitted cell is compared against its confirmed value", () => {
  assert.equal(newEtcDiff({ needsReview: false, newEtcDraft: null, newEtc: 50, priorEtc: 100, hoursWorked: 40 }), 10);
});

test("newEtcDiff: a decided cell that matches what's left is on plan", () => {
  assert.equal(newEtcDiff({ needsReview: true, newEtcDraft: 60, newEtc: 0, priorEtc: 100, hoursWorked: 40 }), 0);
});

test("effectiveNewEtc: forecast still uses the suggestion when undecided", () => {
  // The Total New ETC column is a forecast of what submitting now would write,
  // so it DOES include the suggestion — only the variance excludes it.
  assert.equal(effectiveNewEtc({ needsReview: true, newEtcDraft: null, newEtc: 0, priorEtc: 100, hoursWorked: 40 }), 60);
  assert.equal(effectiveNewEtc({ needsReview: true, newEtcDraft: null, newEtc: 0, priorEtc: 20, hoursWorked: 50 }), 0);
  assert.equal(effectiveNewEtc({ needsReview: true, newEtcDraft: 15, newEtc: 0, priorEtc: 20, hoursWorked: 5 }), 15);
  assert.equal(effectiveNewEtc({ needsReview: false, newEtcDraft: 15, newEtc: 7, priorEtc: 20, hoursWorked: 5 }), 7);
});

test("isNewEtcDecided: draft or submitted, nothing else", () => {
  assert.equal(isNewEtcDecided({ needsReview: true, newEtcDraft: null }), false);
  assert.equal(isNewEtcDecided({ needsReview: true, newEtcDraft: 0 }), true); // an explicit zero IS a decision
  assert.equal(isNewEtcDecided({ needsReview: false, newEtcDraft: null }), true);
});

// ── Prior ETC carry-forward source ──────────────────────────────────────────
//
// Found 2026-08-02 on job 1104: seeding read only prevMonth(month) and fell
// back to QUOTED hours when it found nothing, so a job that skipped a single
// period came back at its full original quote instead of the balance it had
// been worked down to — 1420h where it should have been 0. 49 entries across
// 21 jobs were wrong. These pin the rule so it cannot regress quietly, which
// is the only way it would come back: nothing errors, the numbers just inflate.
test("carry-forward uses the latest prior month, not the month before", () => {
  const rows = [
    { jobId: 5, section: "10-211", month: "2026-04", newEtc: 8 },
    { jobId: 5, section: "10-211", month: "2026-05", newEtc: 0 },
    // no 2026-06 row at all — the job dropped out of the active filter
  ];
  const m = latestPriorEtcByKey(rows);
  assert.equal(m.get("5-10-211"), 0, "must resume from May's 0, not fall through to quoted");
});

test("carry-forward is per job AND section, not per job", () => {
  const rows = [
    { jobId: 5, section: "10-211", month: "2026-05", newEtc: 0 },
    { jobId: 5, section: "10-312", month: "2026-03", newEtc: 235 },
    { jobId: 9, section: "10-211", month: "2026-05", newEtc: 77 },
  ];
  const m = latestPriorEtcByKey(rows);
  assert.equal(m.get("5-10-211"), 0);
  assert.equal(m.get("5-10-312"), 235); // its own latest month, not the job's
  assert.equal(m.get("9-10-211"), 77);
});

test("carry-forward month order does not depend on the query's row order", () => {
  // The rule picks the highest month string; it must not depend on the DB
  // handing rows back sorted, which nothing guarantees.
  const ascending = [
    { jobId: 5, section: "10-211", month: "2026-01", newEtc: 40 },
    { jobId: 5, section: "10-211", month: "2026-05", newEtc: 0 },
  ];
  const descending = [...ascending].reverse();
  assert.equal(latestPriorEtcByKey(ascending).get("5-10-211"), 0);
  assert.equal(latestPriorEtcByKey(descending).get("5-10-211"), 0);
});

test("carry-forward compares months correctly across a year boundary", () => {
  const rows = [
    { jobId: 5, section: "10-211", month: "2025-09", newEtc: 12 },
    { jobId: 5, section: "10-211", month: "2026-01", newEtc: 3 },
  ];
  assert.equal(latestPriorEtcByKey(rows).get("5-10-211"), 3);
});

test("no ETC history at all yields nothing, so the caller falls back to quoted", () => {
  // The one case where quoted hours ARE right: a genuinely new job.
  assert.equal(latestPriorEtcByKey([]).get("5-10-211"), undefined);
});

test("a carried balance of 0 is a real value, not 'missing'", () => {
  // The whole bug in one assertion: 0 must survive as 0. A truthiness check
  // anywhere in this path sends it back to quoted hours.
  const m = latestPriorEtcByKey([{ jobId: 5, section: "10-211", month: "2026-05", newEtc: 0 }]);
  assert.ok(m.has("5-10-211"));
  assert.equal(m.get("5-10-211"), 0);
});
