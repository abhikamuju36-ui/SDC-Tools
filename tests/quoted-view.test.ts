import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isShowingAll,
  isActualsOn,
  ACTUALS_PARAM,
  encodeParamList,
  decodeParamList,
  QUOTED_VIEW_PARAMS,
  type ShowAllOptions,
} from "../src/lib/quoted-display-prefs";

const ALL: ShowAllOptions = {
  customers: ["Acme", "First Solar"],
  types: ["Custom", "Duplicate"],
  statuses: ["Active", "Complete"],
  billables: ["Billable", "Non-Billable"],
  cols: ["10-211", "10-411"],
};

const everything = () =>
  new URLSearchParams({
    customers: encodeParamList(ALL.customers),
    types: encodeParamList(ALL.types),
    statuses: encodeParamList(ALL.statuses),
    billables: encodeParamList(ALL.billables),
    cols: encodeParamList(ALL.cols),
    actuals: "1",
  });

// ── The comma-in-a-value bug (2026-07-31) ────────────────────────────────────
// 16 of 88 real customer names contain a comma. With a raw join/split, clicking
// "Show all" wrote a list the page shredded back into fragments matching no job:
// those rows vanished, and isShowingAll couldn't find the intact name it had
// just written, so the switch snapped back to OFF.
const COMMA_NAMES = ["FIRST SOLAR, INC.", "Alcon Research, LTD", "Tarkett USA, Inc.", "Acme"];

test("encode/decode round-trips values containing commas", () => {
  assert.deepEqual(decodeParamList(encodeParamList(COMMA_NAMES)), COMMA_NAMES);
});

test("a raw split is what broke it — the escape keeps the count right", () => {
  assert.equal(encodeParamList(COMMA_NAMES).split(",").length, 4);
  assert.equal(COMMA_NAMES.join(",").split(",").length, 7); // the old behaviour
});

test("encode/decode survives a literal percent, including a fake escape", () => {
  const tricky = ["50%", "odd%2Cname", "%25", "plain"];
  assert.deepEqual(decodeParamList(encodeParamList(tricky)), tricky);
});

test("the encoded list survives a trip through a query string", () => {
  const qs = new URLSearchParams({ customers: encodeParamList(COMMA_NAMES) });
  const parsed = new URLSearchParams(qs.toString());
  assert.deepEqual(decodeParamList(parsed.get("customers")), COMMA_NAMES);
});

test("isShowingAll sees comma-bearing customers it wrote itself", () => {
  const all: ShowAllOptions = { ...ALL, customers: COMMA_NAMES };
  const p = new URLSearchParams({
    customers: encodeParamList(COMMA_NAMES),
    types: encodeParamList(all.types),
    statuses: encodeParamList(all.statuses),
    billables: encodeParamList(all.billables),
    cols: encodeParamList(all.cols),
    actuals: "1",
  });
  assert.equal(isShowingAll(p, all), true);
  // And the old encoding must NOT read as all — this is the regression itself.
  p.set("customers", COMMA_NAMES.join(","));
  assert.equal(isShowingAll(p, all), false);
});

test("decodeParamList: absent and empty both mean no values", () => {
  assert.deepEqual(decodeParamList(null), []);
  assert.deepEqual(decodeParamList(""), []);
});

test("isShowingAll: every param covered + actuals on", () => {
  assert.equal(isShowingAll(everything(), ALL), true);
});

test("isShowingAll: actuals off is not 'all'", () => {
  const p = everything();
  p.delete(ACTUALS_PARAM);
  assert.equal(isShowingAll(p, ALL), false);
});

// Actuals moved out of localStorage and into the URL (2026-08-01) so one
// navigation carries the whole view — the split is what made the Show-all
// switch and the Display menu able to disagree about it.
test("isActualsOn: only an explicit 1 is on", () => {
  assert.equal(isActualsOn(new URLSearchParams("actuals=1")), true);
  assert.equal(isActualsOn(new URLSearchParams("actuals=0")), false);
  assert.equal(isActualsOn(new URLSearchParams("")), false);
});

test("Reset clears actuals too — it's in QUOTED_VIEW_PARAMS", () => {
  assert.ok((QUOTED_VIEW_PARAMS as readonly string[]).includes(ACTUALS_PARAM));
  const p = everything();
  for (const k of QUOTED_VIEW_PARAMS) p.delete(k);
  assert.equal(isActualsOn(p), false);
  assert.equal(isShowingAll(p, ALL), false);
});

test("isShowingAll: an ABSENT param is the narrower default, not 'all'", () => {
  // The asymmetry worth pinning: no `statuses` means Active-only on this grid,
  // so it must NOT read as everything-visible.
  const p = everything();
  p.delete("statuses");
  assert.equal(isShowingAll(p, ALL), false);
});

test("isShowingAll: an absent `hide` DOES mean nothing hidden", () => {
  const p = everything();
  assert.equal(p.get("hide"), null);
  assert.equal(isShowingAll(p, ALL), true);
  p.set("hide", "customer");
  assert.equal(isShowingAll(p, ALL), false);
});

test("isShowingAll: a missing value inside a param is not 'all'", () => {
  const p = everything();
  p.set("statuses", "Active"); // Complete dropped
  assert.equal(isShowingAll(p, ALL), false);
});

test("isShowingAll: param order doesn't matter", () => {
  const p = everything();
  p.set("billables", "Non-Billable,Billable");
  assert.equal(isShowingAll(p, ALL), true);
});

test("QUOTED_VIEW_PARAMS covers every param the switch sets", () => {
  // Reset deletes this list; if the switch ever sets a param that isn't in it,
  // Reset would leave the grid half-reset.
  for (const p of ["customers", "types", "statuses", "billables", "cols", "hide", "actuals"]) {
    assert.ok((QUOTED_VIEW_PARAMS as readonly string[]).includes(p), `${p} missing from QUOTED_VIEW_PARAMS`);
  }
});

// "Dates ▾" (ProjectsDateFilter). Unlike every list param here, ABSENT is the
// permissive state — no range means no date filtering — so the switch has to
// test for presence, not coverage. Getting that backwards would leave "Show
// all" reading ON while a range quietly hid rows, which is the exact failure
// isShowingAll exists to prevent.
test("isShowingAll: a date range means NOT everything is showing", () => {
  const from = everything();
  from.set("from", "2026-01-01");
  assert.equal(isShowingAll(from, ALL), false);

  const to = everything();
  to.set("to", "2026-12-31");
  assert.equal(isShowingAll(to, ALL), false);
});

test("isShowingAll: no date range at all is still 'showing all'", () => {
  assert.equal(isShowingAll(everything(), ALL), true);
});

test("Reset clears the date range — the params are in QUOTED_VIEW_PARAMS", () => {
  for (const k of ["dateField", "from", "to"]) {
    assert.ok((QUOTED_VIEW_PARAMS as readonly string[]).includes(k), `${k} missing from QUOTED_VIEW_PARAMS`);
  }
  const p = everything();
  p.set("dateField", "complete");
  p.set("from", "2026-01-01");
  p.set("to", "2026-06-30");
  for (const k of QUOTED_VIEW_PARAMS) p.delete(k);
  assert.equal(p.get("from"), null);
  assert.equal(p.get("to"), null);
  assert.equal(p.get("dateField"), null);
});
