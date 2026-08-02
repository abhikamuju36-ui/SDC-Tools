import { test } from "node:test";
import assert from "node:assert/strict";
import {
  poolCategoryForPunch,
  POOL_CATEGORIES,
  POOL_QUOTED_SECTION,
  ETC_TRACKED_CODES,
  RESTRICTED_SECTION_CODES,
} from "../src/lib/sections";

// The four Standard Fees pools and the punch-bucketing behind their "Hours
// Worked this Month". The buckets were pinned against the archived Power BI
// figures on 2026-07-31 (scripts/_recon_pool_local_dryrun.ts): both Warranty
// pools reproduce the stored value exactly for 2026-02/04/05, and Manufacturing
// lands within 0.03h for 2026-04. These tests hold that mapping in place.

test("the four pools are exactly the sections the ETC grid excludes", () => {
  // Not a coincidence to be tidied away later: PM, Manufacturing and both
  // Warranty phases have no grid column BECAUSE they are planned company-wide
  // in these pools instead of job by job.
  for (const category of POOL_CATEGORIES) {
    assert.equal(
      ETC_TRACKED_CODES.has(POOL_QUOTED_SECTION[category]),
      false,
      `${category}'s section ${POOL_QUOTED_SECTION[category]} must not also be an ETC grid column`,
    );
  }
  assert.equal(new Set(Object.values(POOL_QUOTED_SECTION)).size, 4);
});

test("PM and Manufacturing bucket from phase 10 only", () => {
  assert.equal(poolCategoryForPunch("10", "111"), "ENGINEERING_PM");
  // The punch data books manufacturing to 414; 413 is the app's column code.
  assert.equal(poolCategoryForPunch("10", "414"), "SHOP_MANUFACTURING");
  assert.equal(poolCategoryForPunch("10", "413"), "SHOP_MANUFACTURING");

  // Counting 414 in every phase ran ~40h/month above the archived figure, and
  // would contradict the app's own alias, which maps 10-414 and no other.
  assert.equal(poolCategoryForPunch("40", "414"), null);
  assert.equal(poolCategoryForPunch("50", "414"), null);
  assert.equal(poolCategoryForPunch("40", "111"), null);
});

test("warranty splits into engineering and shop by function", () => {
  for (const fn of ["211", "311", "312", "313"]) {
    assert.equal(poolCategoryForPunch("70", fn), "ENGINEERING_WARRANTY", `70-${fn}`);
  }
  for (const fn of ["411", "412"]) {
    assert.equal(poolCategoryForPunch("70", fn), "SHOP_WARRANTY", `70-${fn}`);
  }
});

test("everything else buckets nowhere rather than into the nearest pool", () => {
  // Ordinary Design & Build engineering — belongs to the grid, not a pool.
  assert.equal(poolCategoryForPunch("10", "211"), null);
  assert.equal(poolCategoryForPunch("10", "312"), null);
  assert.equal(poolCategoryForPunch("10", "411"), null);
  // Phases the app does not model at all.
  assert.equal(poolCategoryForPunch("80", "311"), null);
  assert.equal(poolCategoryForPunch("90", "411"), null);
  // Junk in, null out — never a wrong bucket.
  assert.equal(poolCategoryForPunch("", ""), null);
});

test("every pool category has a quoted section, and vice versa", () => {
  assert.equal(POOL_CATEGORIES.length, 4);
  for (const category of POOL_CATEGORIES) {
    assert.ok(POOL_QUOTED_SECTION[category], `${category} has no quoted section`);
  }
  assert.deepEqual(
    [...POOL_CATEGORIES].sort(),
    Object.keys(POOL_QUOTED_SECTION).sort(),
  );
});

// The Projects grid hides these four behind its password gate (projects-gate.ts).
// Pinned because the consequence of the set silently shrinking is a section
// becoming visible to everyone with no error anywhere — the quiet kind of
// failure, not the loud kind.
test("the gated Projects sections are exactly the four pool sections", () => {
  assert.deepEqual([...RESTRICTED_SECTION_CODES].sort(), ["10-111", "10-413", "70-211", "70-411"]);
});

test("the gated set stays derived from the pool sections, not hand-listed", () => {
  // Same membership, checked from the other direction: if someone adds a fifth
  // pool, the gate must pick it up without a second edit.
  assert.equal(RESTRICTED_SECTION_CODES.size, Object.keys(POOL_QUOTED_SECTION).length);
  for (const code of Object.values(POOL_QUOTED_SECTION)) {
    assert.ok(RESTRICTED_SECTION_CODES.has(code), `${code} is a pool section but isn't gated`);
  }
});
