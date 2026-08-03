// Core ETC math, ported from "Managers Fill Out" as confirmed by Dan:
// - suggested hours left = prior ETC - hours worked this month
// - if zero hours worked, assume no progress: new ETC carries forward = prior ETC
// - otherwise the manager confirms/overrides the suggested value
export function calcHoursLeft(priorEtc: number, hoursWorked: number): number {
  return priorEtc - hoursWorked;
}

export function suggestNewEtc(priorEtc: number, hoursWorked: number): number {
  if (hoursWorked === 0) return priorEtc;
  return Math.max(calcHoursLeft(priorEtc, hoursWorked), 0);
}

// Has a manager actually decided this cell's New ETC? Submitted (needsReview
// false) or typed-and-saved (a draft) both count; anything else is still the
// machine's suggestion standing in for an answer nobody has given.
export function isNewEtcDecided(entry: { needsReview: boolean; newEtcDraft: unknown }): boolean {
  return !entry.needsReview || entry.newEtcDraft != null;
}

// What a row's New ETC currently amounts to: the submitted value, else the saved
// draft, else the suggestion. Shared so the grid, its totals and the KPI cards
// cannot each answer this differently.
export function effectiveNewEtc(entry: {
  needsReview: boolean;
  newEtc: unknown;
  newEtcDraft: unknown;
  priorEtc: unknown;
  hoursWorked: unknown;
}): number {
  if (!entry.needsReview) return Number(entry.newEtc);
  if (entry.newEtcDraft != null) return Number(entry.newEtcDraft);
  return suggestNewEtc(Number(entry.priorEtc), Number(entry.hoursWorked));
}

// Diff — "how far is the manager's New ETC from the hours actually remaining?" —
// and NULL when there is no decision to compare.
//
// It used to compare the SUGGESTION for undecided cells, which quietly turned
// every overspent-but-untouched cell into an overage: suggestNewEtc clamps at 0
// (a plan cannot be negative) while Hours Left stays negative, so the clamped gap
// surfaced as "over" on a cell nobody had opened. Measured on 2026-07-31, that was
// −1,065 of Engineering's −1,071 and −325 of Shop's −310: essentially the whole
// figure, invented, with exactly ONE of 241 Engineering cells actually decided.
//
// A number nobody entered must not be reported as their overrun.
export function newEtcDiff(entry: {
  needsReview: boolean;
  newEtc: unknown;
  newEtcDraft: unknown;
  priorEtc: unknown;
  hoursWorked: unknown;
}): number {
  // An UNTYPED New ETC counts as 0; a typed one counts as max(value, 0)
  // (2026-08-03, by request). This is the second revision of the rule, so both
  // predecessors are worth recording.
  //
  // Until 2026-08-02 this returned null for an undecided cell, so the column read
  // "—" across most of the grid and hid the one thing it exists to show: a
  // section already burned past its Prior ETC. That was replaced by comparing
  // against the SUGGESTION, which fixed the overruns but produced a column that
  // could not be read off the screen, and was reported as a bug:
  //
  //     Prior 174, Worked  98 -> Left  77, blank New ETC -> Diff 0
  //     Prior 160, Worked 167 -> Left  -7, blank New ETC -> Diff -7
  //
  // Both were right under that rule — the suggestion clamps at 0, so it equals
  // Hours Left while Hours Left is positive and 0 once it goes negative — but with
  // the cell visibly empty the two look arbitrary side by side.
  //
  // Treating a blank as 0 makes the column say ONE thing: Diff is Hours Left
  // until somebody plans the section, and the real variance once they do.
  // Overspent cells are unaffected (-7 stays -7); the 77 now reads as 77 hours
  // nobody has accounted for, which is a fair thing to be told.
  //
  // Scope: this is how DIFF reads an empty cell. effectiveNewEtc is deliberately
  // NOT changed — it answers "what will this month be if submitted as-is", and
  // the carry-forward into next month's Prior ETC depends on that answer. Making
  // it 0 would zero every unplanned section's balance at submission.
  // An UNDECIDED cell has no variance and contributes NOTHING (2026-08-03, third
  // and final revision — see the history above). Diff reports decisions: until a
  // manager enters a New ETC there is nothing to compare against, so the cell
  // prints empty and adds 0 to every total that sums it.
  //
  // Returning 0 rather than null keeps every caller — the cell, the row totals,
  // the grand total, the KPI cards, the live store — on one numeric type. "Adds
  // nothing" and "is nothing" are the same thing to a sum; only the CELL needs to
  // tell them apart, and it does that with isNewEtcDecided directly.
  if (!isNewEtcDecided(entry)) return 0;
  return calcHoursLeft(Number(entry.priorEtc), Number(entry.hoursWorked)) - Math.max(effectiveNewEtc(entry), 0);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// "YYYY-MM" month arithmetic, shared by seeding (carry-forward source), the
// in-order start guard, and the month picker's "next startable month" option.
export function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2, 1); // m is 1-indexed; m-2 lands on the previous month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m, 1); // m is 1-indexed; index m is the next month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function isValidMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

// The Prior ETC carry-forward source for every job/section: the New ETC of the
// LATEST month before `month` that has an entry for it — not necessarily the
// month immediately before.
//
// Why this is not just prevMonth (found 2026-08-02, job 1104):
//
// Seeding used to read prevMonth(month) alone, and fall back to the job's
// QUOTED hours when it found nothing. That fallback is right for a job with no
// ETC history at all — the report's own rule (verified 2026-07-17) is that a
// job entering its first ETC period starts from quoted. It is badly wrong for a
// job that merely SKIPPED a month, which happens whenever a job drops out of
// etcActiveJobFilter for one period and comes back: seedMonth doesn't seed it,
// pruneStaleEntries removes any unsubmitted row, and the month has no entry.
//
// The result was a silent balance RESET. 1104's ME Gen had been worked down
// 40 -> 9 -> 8 -> 40 -> 0 across five months, had no June row, and reappeared
// in July at 1420 — its full original quote. Across the grid that was 49
// entries on 21 jobs, and it inflates every figure downstream of Prior ETC:
// Hours Left, the suggested New ETC, and the dollars on the Standard sheet.
//
// Pure and separate from the query so the rule can be tested; callers pass
// whatever prior rows they've already fetched.
export function latestPriorEtcByKey<T extends { jobId: number; section: string; month: string; newEtc: unknown }>(
  priorEntries: T[],
): Map<string, number> {
  // Keyed jobId-section; the winner is the highest month string, which sorts
  // correctly because months are zero-padded YYYY-MM.
  const bestMonth = new Map<string, string>();
  const out = new Map<string, number>();
  for (const e of priorEntries) {
    const key = `${e.jobId}-${e.section}`;
    const seen = bestMonth.get(key);
    if (seen !== undefined && seen >= e.month) continue;
    bestMonth.set(key, e.month);
    out.set(key, Number(e.newEtc));
  }
  return out;
}

// Weekday (Mon–Fri) count for a "YYYY-MM" month — the same rule as the
// report's [ETC Historical Working Days] measure (COUNTROWS of 'Date' where
// Is Weekend = FALSE for the work month). No holiday calendar on either
// side, so plain weekday counting IS exact parity.
export function workingDaysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate(); // day 0 of next month = last day of this one
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(y, m - 1, d).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

// A month is locked once every entry in it has been submitted/confirmed.
// `length > 0` matters: `Array.every` on an empty array is vacuously true, which
// would make a month with no entries yet (never started) look "locked".
export function isMonthLocked(entries: { needsReview: boolean }[]): boolean {
  return entries.length > 0 && entries.every((e) => !e.needsReview);
}

// Is `month` safe for Power BI's LIVE hours/parts sync (Run Report)? Only the
// single most-recently-started month qualifies — either it's already the
// latest (an ongoing refresh) or it's the very next one (starting a new
// month, which has no entries yet so can never itself be "latest"). `null`
// latestMonth means no month has ever been started — anything goes.
//
// Found 2026-07-14: reopening an OLDER month and running Run Report seeds/
// resyncs it against TODAY's active-job roster and TODAY's raw actuals —
// wrong on both counts for a month that's already closed. Proven by directly
// reopening a corrected historical month and running it: real entries for
// since-completed jobs were deleted, and entries for jobs that only became
// active later were injected. See sync-etc-history.ts's assertCurrentEtcMonth.
export function isSafeForLiveEtcSync(month: string, latestMonth: string | null): boolean {
  if (latestMonth === null) return true;
  return month === latestMonth || month === nextMonth(latestMonth);
}

// Has Power BI actually published a real (non-blank) historical value for
// this month? Power BI's SUMMARIZECOLUMNS returns a row per Job/measure combo
// whether or not the period has been archived yet — an unarchived period
// still yields rows, just with every measure BLANK (→ null here). Used by
// sync-etc-history.ts to detect when a month that's locked in the app (and
// therefore normally skipped) now has real Power BI data available, so a
// premature/stale submission doesn't silently stay wrong forever — see the
// June 2026 data-correction incident.
export function hasPublishedHistory(rows: { NewEtc: number | null }[]): boolean {
  return rows.some((r) => r.NewEtc != null);
}

// Same idea as hasPublishedHistory, but for the 'Standard Fees' archive
// table, which reports existence via rows (a month with no archive yet
// simply has no rows at all) rather than a nullable measure. Splits Power
// BI's flat row list into per-month buckets, routing rows for an app-owned
// month into `ownedRowsByMonth` (+ `ownedWithHistoryNow` for visibility)
// instead of `rowsByMonth` — so syncCategoryPoolHistory can skip the normal
// full-replace path for that month while still reconciling its non-decision
// fact fields against the newly-available archive.
export function groupStandardFeesRows<Row>(
  rows: Row[],
  monthForRow: (row: Row) => string | undefined,
  ownedMonths: Set<string>
): { rowsByMonth: Map<string, Row[]>; ownedWithHistoryNow: string[]; ownedRowsByMonth: Map<string, Row[]> } {
  const rowsByMonth = new Map<string, Row[]>();
  const ownedRowsByMonth = new Map<string, Row[]>();
  const ownedWithHistoryNow: string[] = [];
  for (const row of rows) {
    const month = monthForRow(row);
    if (!month) continue;
    if (ownedMonths.has(month)) {
      if (!ownedWithHistoryNow.includes(month)) ownedWithHistoryNow.push(month);
      if (!ownedRowsByMonth.has(month)) ownedRowsByMonth.set(month, []);
      ownedRowsByMonth.get(month)!.push(row);
      continue;
    }
    if (!rowsByMonth.has(month)) rowsByMonth.set(month, []);
    rowsByMonth.get(month)!.push(row);
  }
  return { rowsByMonth, ownedWithHistoryNow, ownedRowsByMonth };
}
