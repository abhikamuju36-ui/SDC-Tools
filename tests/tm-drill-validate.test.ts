import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeJobIds, isValidCalendarDate, isValidDateRange } from "../src/lib/tm-drill-validate";

test("a well-formed date range is valid", () => {
  assert.equal(isValidDateRange("2026-01-01", "2026-03-31"), true);
});

test("wrong shape is rejected", () => {
  assert.equal(isValidCalendarDate("2026/01/01"), false);
  assert.equal(isValidCalendarDate("01-01-2026"), false);
  assert.equal(isValidCalendarDate(""), false);
  assert.equal(isValidCalendarDate("not-a-date"), false);
});

test("a calendar date that doesn't exist is rejected, not silently rolled forward", () => {
  // JS's Date would happily turn this into March 2 — this must catch it first.
  assert.equal(isValidCalendarDate("2026-02-30"), false);
  assert.equal(isValidCalendarDate("2026-04-31"), false);
  assert.equal(isValidCalendarDate("2026-13-01"), false);
});

test("Feb 29 is valid on a leap year, rejected on a non-leap year", () => {
  assert.equal(isValidCalendarDate("2024-02-29"), true); // leap
  assert.equal(isValidCalendarDate("2026-02-29"), false); // not a leap year
});

test("a range with either end invalid is an invalid range", () => {
  assert.equal(isValidDateRange("2026-02-30", "2026-03-31"), false);
  assert.equal(isValidDateRange("2026-01-01", "2026-02-30"), false);
});

test("sanitizeJobIds drops non-strings, empty strings, and anything absurdly long", () => {
  const result = sanitizeJobIds(["1101", "", "x".repeat(21), "1104"]);
  assert.deepEqual(result, ["1101", "1104"]);
});

test("sanitizeJobIds caps the list at 500 entries", () => {
  const many = Array.from({ length: 600 }, (_, i) => String(i));
  assert.equal(sanitizeJobIds(many).length, 500);
});

test("an all-invalid selection sanitizes down to an empty array, not to a single fallback value", () => {
  assert.deepEqual(sanitizeJobIds(["", "x".repeat(50)]), []);
});

test("an already-empty selection stays empty (this is the 'All Jobs' convention upstream, not this function's concern)", () => {
  assert.deepEqual(sanitizeJobIds([]), []);
});
