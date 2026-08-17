import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Parts List invoiced-window fix: scope guards (2026-08-09) ────────────────
//
// No React test renderer exists in this repo (see tests/job-procurement-
// collapse.test.ts's own note) — this asserts on source structure, the same
// treatment that file and tests/drill-design.test.ts give their own files.
// The one thing worth a real regression guard here: the blast-radius scan
// behind this fix concluded RiskCards/PartsCardView/PoPanel never need to know
// about the windowed-invoiced state at all (they read dates/status/PO data,
// never invoicedAmount-derived fields) — pinning that so a future edit doesn't
// casually widen the window state's reach into places that were deliberately
// left alone.

const SRC = join(import.meta.dirname, "..", "src");
const strip = (raw: string) =>
  raw
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/[^\n]*$/gm, "")
    .replace(/\/\/[^\n"'`]*$/gm, "");

const RAW = readFileSync(join(SRC, "components", "JobProcurement.tsx"), "utf8");
const CODE = strip(RAW);

// The FlatPart type + flatten-and-join logic (2026-08-17) live in po-detail.ts
// now, shared with the Build Readiness PO drawer — moved out of
// JobProcurement.tsx, not rewritten, so the same source-shape guards apply
// against their new home.
const PO_DETAIL_CODE = strip(readFileSync(join(SRC, "lib", "po-detail.ts"), "utf8"));
// PoPanel itself moved the same way, into the shared drawer component.
const PO_PANEL_CODE = strip(readFileSync(join(SRC, "components", "procurement", "PoDetailPanel.tsx"), "utf8"));

function functionBody(code: string, name: string, fileLabel: string): string {
  const start = code.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist in ${fileLabel}`);
  const nextFn = code.indexOf("\nfunction ", start + 1);
  return nextFn === -1 ? code.slice(start) : code.slice(start, nextFn);
}

test("pctInvoiced and leftToSpend are nullable — a windowed figure isn't mixed with a lifetime one", () => {
  assert.match(PO_DETAIL_CODE, /pctInvoiced: number \| null/, "pctInvoiced must be nullable");
  assert.match(PO_DETAIL_CODE, /leftToSpend: number \| null/, "leftToSpend must be nullable");
});

test("invoicedAmount is drawn from the window attribution, not just the lifetime PartsCostLine, when a window is active", () => {
  const fnBody = functionBody(PO_DETAIL_CODE, "flattenBomParts", "po-detail.ts");
  assert.match(fnBody, /activeAttribution\?\.byPartNumber\.get\(normPn\(p\.pn\)\)/, "a windowed row must look up its own part number in the attribution map");
});

test("row inclusion for Invoiced+range switches off the resolved window's invoicedAmount, not the stale single-date field", () => {
  const fnBody = functionBody(CODE, "PartsListTab", "JobProcurement.tsx");
  assert.match(fnBody, /windowStatus\.active/, "the date-inclusion branch must consult whether a window is actually active");
  assert.match(fnBody, /p\.invoicedAmount === 0/, "a windowed row is excluded by zero invoiced amount, not by its collapsed lifetime invoicedDate");
});

test("Purchase mode's date-inclusion branch is unchanged — still a plain purchasedDate/invoicedDate comparison, with Req/Exp Date added as more single-field modes alongside it (2026-08-14)", () => {
  const fnBody = functionBody(CODE, "PartsListTab", "JobProcurement.tsx");
  assert.match(
    fnBody,
    /dateType === "purchase" \? p\.purchasedDate :\s*dateType === "invoice" \? p\.invoicedDate :\s*dateType === "req" \? p\.requiredDate :\s*p\.expectedDate/,
    "Purchase/Invoiced/Req Date/Exp Date must each resolve to their own plain date field — none of them may pick up windowed-invoiced logic",
  );
});

test("the footer reconciliation row is gated on an active window, a non-zero unattached amount, and the Invoiced column being visible", () => {
  const fnBody = functionBody(CODE, "PartsTableView", "JobProcurement.tsx");
  assert.match(
    fnBody,
    /windowStatus\.active && windowStatus\.unattachedAmount !== 0 && cols\.some\(\(c\) => c\.key === "invoiced"\)/,
    "the reconciliation row must not render for an unresolved window, a zero amount, or a hidden Invoiced column",
  );
});

test("the footer's leftToSpend/pctInvoiced totals render as unavailable, not a silently-wrong sum, when a window is active", () => {
  const fnBody = functionBody(CODE, "PartsTableView", "JobProcurement.tsx");
  assert.match(fnBody, /if \(p\.leftToSpend !== null\) a\.left \+= p\.leftToSpend/, "null rows must be skipped in the footer sum, not coerced to 0 silently");
  assert.match(fnBody, /windowStatus\.active \? "—" : usd\(tot\.left\)/, "the footer must show — rather than a sum that would always be $0 when windowed");
});

test("a job switch never applies a different job's cached window — the attribution is job-matched", () => {
  const fnBody = functionBody(CODE, "JobProcurement", "JobProcurement.tsx");
  assert.match(
    fnBody,
    /windowResult\.jobId === bom\.jobId && windowResult\.from === from && windowResult\.to === to/,
    "the cached window must be re-validated against the CURRENT job/from/to before being applied",
  );
});

test("RiskCards never references the windowed-invoiced state", () => {
  const fnBody = functionBody(CODE, "RiskCards", "JobProcurement.tsx");
  assert.doesNotMatch(fnBody, /windowStatus|activeAttribution|windowResult/, "RiskCards is about delivery risk/PO status, not money — it must stay untouched by this fix");
});

test("PartsCardView never references the windowed-invoiced state", () => {
  const fnBody = functionBody(CODE, "PartsCardView", "JobProcurement.tsx");
  assert.doesNotMatch(fnBody, /windowStatus|activeAttribution|windowResult/, "the Card view groups by supplier/PO — it must stay untouched by this fix");
});

test("PoPanel never references the windowed-invoiced state", () => {
  const fnBody = functionBody(PO_PANEL_CODE, "PoPanel", "PoDetailPanel.tsx");
  assert.doesNotMatch(fnBody, /windowStatus|activeAttribution|windowResult/, "the PO side panel computes its own independent PO Value figure — it must stay untouched by this fix");
});
