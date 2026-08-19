import { test } from "node:test";
import assert from "node:assert/strict";
import { isOpenHiringStatus, isManualJobStatus, MANUAL_JOB_STATUSES, DEFAULT_MANUAL_JOB_STATUS } from "../src/lib/hiring-position-status";

test("isOpenHiringStatus: an ordinary open-sounding status is open", () => {
  assert.equal(isOpenHiringStatus("Published", null, false), true);
  assert.equal(isOpenHiringStatus("Open", null, false), true);
});

test("isOpenHiringStatus: archived always closes it regardless of status text", () => {
  assert.equal(isOpenHiringStatus("Open", null, true), false);
});

test("isOpenHiringStatus: a closed-keyword status closes it even if not archived", () => {
  for (const status of ["Filled", "Closed", "Cancelled", "Canceled", "Withdrawn", "Expired", "On Hold"]) {
    assert.equal(isOpenHiringStatus(status, null, false), false, `expected "${status}" to be closed`);
  }
});

test("isOpenHiringStatus: a closed-keyword sub-status closes it even when the main status looks open", () => {
  assert.equal(isOpenHiringStatus("Published", "Cancelled", false), false);
});

test("every MANUAL_JOB_STATUSES entry other than the default resolves to closed", () => {
  for (const status of MANUAL_JOB_STATUSES) {
    const expectOpen = status === DEFAULT_MANUAL_JOB_STATUS;
    assert.equal(isOpenHiringStatus(status, null, false), expectOpen, `"${status}" open-ness mismatch`);
  }
});

test("isManualJobStatus rejects free text outside the fixed vocabulary", () => {
  assert.equal(isManualJobStatus("Open"), true);
  assert.equal(isManualJobStatus("Published"), false);
  assert.equal(isManualJobStatus(""), false);
});
