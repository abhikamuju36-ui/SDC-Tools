import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTmHoursSection, type TmHoursDrillKey } from "../src/lib/tm-hours-classify";
import { ETC_SECTIONS, POOL_QUOTED_SECTION } from "../src/lib/sections";

// classifyTmHoursSection is the ONE function getTmHoursTotals (the KPI
// aggregate) and getTmHoursDrillRows (the drill-through) both run every
// section code through — so a card's KPI total and its own drill-through
// can only ever disagree if this function disagrees with ITSELF between two
// calls, which it can't (it's pure and depends on nothing but its argument).
// These tests pin down the actual code->card mapping, since that's the part
// that's cheap to get subtly wrong (a code moved to the wrong bucket, or a
// bucket overlapping another) without a live database to catch it.

const ALL_KEYS: TmHoursDrillKey[] = ["engineeringHours", "shopHours", "pmHours", "manufacturingHours"];

test("PM Hours is exactly function 111 (10-111) — the same single code poolCategoryForPunch treats as canonical", () => {
  assert.equal(classifyTmHoursSection("10-111"), "pmHours");
  assert.equal(POOL_QUOTED_SECTION.ENGINEERING_PM, "10-111");
});

test("Manufacturing Hours is exactly 10-413 (phase 10 only) — not Spare Parts' own 90-414", () => {
  assert.equal(classifyTmHoursSection("10-413"), "manufacturingHours");
  assert.equal(POOL_QUOTED_SECTION.SHOP_MANUFACTURING, "10-413");
  // 90-414 is a real, separately-imported Spare Parts code (sections.ts's
  // SERVICE_AND_SPARE_PARTS_CODES) — it must NOT fold into Manufacturing
  // Hours, which is exactly the ~40h/month overcount sections.ts's own
  // SECTION_ALIASES comment documents for counting 414 outside phase 10.
  assert.equal(classifyTmHoursSection("90-414"), null);
});

test("every Engineering/Shop billing-group code from ETC_SECTIONS classifies to the matching card, and to no other", () => {
  for (const s of ETC_SECTIONS) {
    const expected = s.billingGroup === "Engineering" ? "engineeringHours" : "shopHours";
    assert.equal(classifyTmHoursSection(s.code), expected, `${s.code} (${s.name}) should classify as ${expected}`);
  }
});

test("PM and Manufacturing codes are excluded from ETC_SECTIONS — Engineering/Shop can never double-count them", () => {
  const etcCodes = new Set(ETC_SECTIONS.map((s) => s.code));
  assert.ok(!etcCodes.has(POOL_QUOTED_SECTION.ENGINEERING_PM), "PM's code must not also be an Engineering/Shop billing-group code");
  assert.ok(!etcCodes.has(POOL_QUOTED_SECTION.SHOP_MANUFACTURING), "Manufacturing's code must not also be an Engineering/Shop billing-group code");
});

test("a code the app doesn't import at all classifies to no card, rather than silently joining one", () => {
  assert.equal(classifyTmHoursSection("99-999"), null);
});

test("every one of the four buckets is non-empty and no code is claimed by two buckets", () => {
  const allCodes = [...ETC_SECTIONS.map((s) => s.code), POOL_QUOTED_SECTION.ENGINEERING_PM, POOL_QUOTED_SECTION.SHOP_MANUFACTURING];
  const seen = new Map<string, TmHoursDrillKey>();
  for (const code of allCodes) {
    const key = classifyTmHoursSection(code);
    assert.ok(key, `${code} must classify to one of the four cards`);
    const prior = seen.get(code);
    assert.ok(!prior || prior === key, `${code} classified as both "${prior}" and "${key}"`);
    seen.set(code, key as TmHoursDrillKey);
  }
  for (const key of ALL_KEYS) {
    assert.ok([...seen.values()].includes(key), `no code classified as "${key}" — that card would always show 0`);
  }
});
