import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTmFilters, buildTmPartsDrillDax, type TmPartsDrillKey } from "../src/lib/tm-report";

// buildTmFilters is the pure, network-free half of tm-report.ts — the DAX
// query itself is only provably correct against the live Power BI model
// (see the plan's manual verification step), but these lock down the two
// things that would silently corrupt every query if they regressed:
// escaping, and the "no selection" case not degenerating into an empty IN{}
// (which would zero out every job instead of meaning "all of them").

test("no job/status selection produces no filter argument for either", () => {
  const args = buildTmFilters({ startDate: "2026-01-01", endDate: "2026-03-31" });
  assert.ok(!args.some((a) => a.includes("Job Id")));
  assert.ok(!args.some((a) => a.includes("Job Status")));
});

test("the date range is always present as a Between-style filter", () => {
  const args = buildTmFilters({ startDate: "2026-01-01", endDate: "2026-03-31" });
  const dateArg = args.find((a) => a.includes("'Date'[Date]"));
  assert.ok(dateArg);
  assert.equal(dateArg, `'Date'[Date] >= DATE(2026,1,1) && 'Date'[Date] <= DATE(2026,3,31)`);
});

test("multiple job ids produce a DAX IN list", () => {
  const args = buildTmFilters({ jobIds: ["1142", "1150"], startDate: "2026-01-01", endDate: "2026-03-31" });
  assert.ok(args.includes(`'Job'[Job Id] IN {"1142","1150"}`));
});

test("multiple job statuses produce a DAX IN list", () => {
  const args = buildTmFilters({ jobStatuses: ["Active", "Complete"], startDate: "2026-01-01", endDate: "2026-03-31" });
  assert.ok(args.includes(`'Job'[Job Status] IN {"Active","Complete"}`));
});

test("a job id containing a double quote is escaped, not left to break the DAX string", () => {
  const args = buildTmFilters({ jobIds: [`11"42`], startDate: "2026-01-01", endDate: "2026-03-31" });
  assert.ok(args.includes(`'Job'[Job Id] IN {"11""42"}`));
});

test("an empty array is treated the same as omitted — no filter, not an empty IN{}", () => {
  const args = buildTmFilters({ jobIds: [], jobStatuses: [], startDate: "2026-01-01", endDate: "2026-03-31" });
  assert.equal(args.length, 1); // only the date range
});

// ── Regression guard for the KPI-vs-drill fan-out bug (2026-08-19) ──────────
//
// A live mismatch (Engineering Hours KPI = 53, drill-through total = 105 —
// almost exactly 2×) traced to the (now-retired) hours drill query grouping
// by a 'Function Hierarchy' dimension column via SUMMARIZECOLUMNS. The fix
// for the Parts cards (which had the same class of risk) is SELECTCOLUMNS
// directly over the 'Part Purchase' FACT table (a 1:1 row projection, immune
// to a dimension's own fan-out) — this test locks down that STRUCTURAL
// property. The Hours cards themselves moved off Power BI entirely
// (2026-08-19, see tests/tm-hours.test.ts) — their own reconciliation
// guarantee now comes from reading one classifier off one local table
// instead, not from a DAX shape.

const ALL_PARTS_KEYS: TmPartsDrillKey[] = ["partInvoicedAmount", "sdcManufacturedPartsSalesPrice", "expenseReports"];

test("the parts drill never groups by a dimension column — it projects the fact table directly", () => {
  for (const key of ALL_PARTS_KEYS) {
    const dax = buildTmPartsDrillDax({ startDate: "2026-01-01", endDate: "2026-03-31" }, key);
    assert.doesNotMatch(dax, /SUMMARIZECOLUMNS/, `${key}: a GROUP BY over a dimension column can fan out and double-count`);
    assert.match(dax, /SELECTCOLUMNS\(\s*'Part Purchase'/, `${key}: must project 'Part Purchase' (the fact table) directly`);
  }
});

test("every parts drill query carries the same job/date filter arguments buildTmFilters produces for the KPI", () => {
  const filters = { jobIds: ["1142", "1150"], startDate: "2026-01-01", endDate: "2026-03-31" };
  const expectedArgs = buildTmFilters(filters);
  for (const key of ALL_PARTS_KEYS) {
    const dax = buildTmPartsDrillDax(filters, key);
    for (const arg of expectedArgs) assert.ok(dax.includes(arg), `${key}: missing filter arg "${arg}" — KPI and drill would scope different rows`);
  }
});
