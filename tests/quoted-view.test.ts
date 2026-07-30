import { test } from "node:test";
import assert from "node:assert/strict";
import { isShowingAll, QUOTED_VIEW_PARAMS, type ShowAllOptions } from "../src/lib/quoted-display-prefs";

const ALL: ShowAllOptions = {
  customers: ["Acme", "First Solar"],
  types: ["Custom", "Duplicate"],
  statuses: ["Active", "Complete"],
  billables: ["Billable", "Non-Billable"],
  cols: ["10-211", "10-411"],
};

const everything = () =>
  new URLSearchParams({
    customers: ALL.customers.join(","),
    types: ALL.types.join(","),
    statuses: ALL.statuses.join(","),
    billables: ALL.billables.join(","),
    cols: ALL.cols.join(","),
  });

test("isShowingAll: every param covered + actuals on", () => {
  assert.equal(isShowingAll(everything(), ALL, true), true);
});

test("isShowingAll: actuals off is not 'all'", () => {
  assert.equal(isShowingAll(everything(), ALL, false), false);
});

test("isShowingAll: an ABSENT param is the narrower default, not 'all'", () => {
  // The asymmetry worth pinning: no `statuses` means Active-only on this grid,
  // so it must NOT read as everything-visible.
  const p = everything();
  p.delete("statuses");
  assert.equal(isShowingAll(p, ALL, true), false);
});

test("isShowingAll: an absent `hide` DOES mean nothing hidden", () => {
  const p = everything();
  assert.equal(p.get("hide"), null);
  assert.equal(isShowingAll(p, ALL, true), true);
  p.set("hide", "customer");
  assert.equal(isShowingAll(p, ALL, true), false);
});

test("isShowingAll: a missing value inside a param is not 'all'", () => {
  const p = everything();
  p.set("statuses", "Active"); // Complete dropped
  assert.equal(isShowingAll(p, ALL, true), false);
});

test("isShowingAll: param order doesn't matter", () => {
  const p = everything();
  p.set("billables", "Non-Billable,Billable");
  assert.equal(isShowingAll(p, ALL, true), true);
});

test("QUOTED_VIEW_PARAMS covers every param the switch sets", () => {
  // Reset deletes this list; if the switch ever sets a param that isn't in it,
  // Reset would leave the grid half-reset.
  for (const p of ["customers", "types", "statuses", "billables", "cols", "hide"]) {
    assert.ok((QUOTED_VIEW_PARAMS as readonly string[]).includes(p), `${p} missing from QUOTED_VIEW_PARAMS`);
  }
});
