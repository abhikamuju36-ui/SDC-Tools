import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── "No Purchase Order" card vs. Parts List "Uncovered (no PO)" filter ──────
//
// Reported bug: the risk card showed ~8 parts while the Parts-List filter for
// the exact same job showed 2. The card computed its own "no PO" set with a
// raw `!poNumber` check (plus a part-number dedup on top of an already
// id-deduped list) instead of reusing the canonical, release-status/stock/
// process-aware `status === "noPO"` the Parts List filter and the readiness
// summary already used — so it counted every stock- and process-covered part
// (which legitimately has no PO) as a gap.
//
// job-bom-rules.ts now exports `isUncoveredPart` as the one rule; this is a
// source-shape regression guard (same convention as
// tests/job-procurement-collapse.test.ts — no React test renderer in this
// repo) pinning down that all three call sites route through it, and that the
// old raw-PO-null pattern doesn't come back.

const SRC = join(import.meta.dirname, "..", "src");
const RAW = readFileSync(join(SRC, "components", "JobProcurement.tsx"), "utf8");

const CODE = RAW.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/[^\n]*$/gm, "")
  .replace(/\/\/[^\n"'`]*$/gm, "");

test("JobProcurement imports the centralized isUncoveredPart rule", () => {
  assert.match(CODE, /import \{ isUncoveredPart \} from "@\/lib\/job-bom-rules";/);
});

test("the No Purchase Order risk card counts via isUncoveredPart, not a raw PO-null check", () => {
  assert.match(CODE, /const noPo = parts\.filter\(isUncoveredPart\);/);
  // The exact defect: a bare `if (p.poNumber) return false` treats "no PO"
  // as "missing", which is wrong the moment a part is covered by stock or an
  // in-house process schedule.
  assert.doesNotMatch(
    CODE,
    /if \(p\.poNumber\) return false;/,
    "the risk card must not re-derive coverage from a raw poNumber check",
  );
});

test("the readiness summary's uncovered count uses isUncoveredPart", () => {
  assert.match(CODE, /const noPO = parts\.filter\(isUncoveredPart\)\.length;/);
});

test("the Parts List \"Uncovered (no PO)\" filter uses isUncoveredPart for the noPO status", () => {
  // 2026-08-15: Status became a checkbox multi-select (any number of statuses
  // at once, by request), so the single-status ternary this used to pin
  // became an OR across every currently-selected status — same per-status
  // rule as before (noPO still resolves via isUncoveredPart, not p.st.key),
  // just no longer limited to exactly one at a time.
  assert.match(
    CODE,
    /s === "noPO" \? isUncoveredPart\(p\) : p\.st\.key === s/,
    "the noPO branch of the status filter must call the same rule as the card and the summary",
  );
});

test("the Uncovered (no PO) filter option is still present and labeled", () => {
  assert.match(CODE, /\{ value: "noPO", label: "Uncovered \(no PO\)" \}/);
});
