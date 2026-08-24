import { runDax } from "@/lib/powerbi-client";
import { normalizePbiJobId } from "@/lib/job-hours-source";

// ── T&M tab data layer — Parts/dollar cards + shared filter helper ─────────
//
// Native recreation of the Power BI "T&M" page (Job Hours Report - Management
// Level.Report, page c54109ba5857acc45cc9) for its three DOLLAR cards (Part
// Invoiced Amount, SDC Manufactured Parts Sales Price, Expense Reports).
// Every value below is fetched LIVE from that exact semantic model via the
// same measures the Power BI page itself uses — never recomputed locally —
// so a number here can never drift from Power BI's own answer for the same
// job/status/date-range selection.
//
// ── The four Hours cards moved out (2026-08-19) ─────────────────────────────
//
// Engineering/Shop/PM/Manufacturing Hours used to be a fourth "8 measures"
// group here too, queried live against Power BI's 'Hours Actual' table. By
// explicit request they now read the app's own local Paylocity ingest
// instead — the SAME data and mappings Monthly ETC's own hours already use —
// so this file no longer touches Power BI for hours at all. See
// src/lib/tm-hours.ts for that pipeline, and TmMetrics below for how a page
// assembles both halves into one object.
//
// Field → measure mapping (verbatim DAX, from Measure Tables.tmdl):
//
//   Job Display                          → Measure Tables[Job Display]
//   Part Invoiced Amount                 → Measure Tables[Part Invoiced Amount]
//   SDC Manufactured Parts Sales Price   → Measure Tables[SDC Manufactured Parts Sales Price]
//   Expense Reports                      → Measure Tables[Expense Reports]
//   (date-picker defaults only)          → Measure Tables[Estimated to Complete As Of Date],
//                                           Measure Tables[Hours Refreshed Thru]
//
// Filter columns: 'Job'[Job Id] (the plain job number — NOT the composite
// 'Job'[Job] display key — confirmed by tracing how sync-actuals.ts populates
// the app's own local Job.jobId field from Hours Estimated[Job Id]/Cost
// Estimated[Job Id], the same string src/components/JobSelect.tsx already
// works in), 'Job'[Job Status], and 'Date'[Date] (a plain Between range — the
// Power BI slicer's own additional 'Date'[Is ETC to Date] filter carries no
// selected values in the saved page state, so it isn't an active restriction
// there either).

export type TmFilters = {
  jobIds?: string[];
  jobStatuses?: string[];
  startDate: string; // yyyy-mm-dd
  endDate: string; // yyyy-mm-dd
};

// The three Power BI-backed dollar fields, plus the job-context display —
// fetchTmMetrics' own return shape.
export type TmPartsMetrics = {
  jobDisplay: string;
  partInvoicedAmount: number;
  sdcManufacturedPartsSalesPrice: number;
  expenseReports: number;
};

// The full 7-KPI shape the T&M UI renders — assembled by the page from
// TmPartsMetrics (Power BI) + TmHoursTotals (local Paylocity, tm-hours.ts).
// Kept here since it's the "whole T&M metrics" concept every UI component
// already imports as a type; nothing in this file computes the four hours
// fields any more.
export type TmMetrics = TmPartsMetrics & {
  engineeringHours: number;
  shopHours: number;
  pmHours: number;
  manufacturingHours: number;
};

export type TmDateDefaults = {
  asOfDate: string | null;
  hoursRefreshedThru: string | null;
};

/** DAX string-literal escaping: a literal `"` inside the value must become `""`. */
function daxString(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function daxDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `DATE(${y},${m},${d})`;
}

/**
 * Builds the CALCULATETABLE filter arguments for the metrics query. Pure and
 * network-free so it's directly unit-testable (tests/tm-report.test.ts) —
 * empty job/status selections produce no filter argument at all, matching
 * "All Jobs Selected" rather than an accidental empty-set IN{} that would
 * zero everything out.
 */
export function buildTmFilters(filters: TmFilters): string[] {
  const args: string[] = [];
  if (filters.jobIds && filters.jobIds.length > 0) {
    args.push(`'Job'[Job Id] IN {${filters.jobIds.map(daxString).join(",")}}`);
  }
  if (filters.jobStatuses && filters.jobStatuses.length > 0) {
    args.push(`'Job'[Job Status] IN {${filters.jobStatuses.map(daxString).join(",")}}`);
  }
  args.push(`'Date'[Date] >= ${daxDate(filters.startDate)} && 'Date'[Date] <= ${daxDate(filters.endDate)}`);
  return args;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toIsoDateOrNull(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export async function fetchTmMetrics(filters: TmFilters): Promise<TmPartsMetrics> {
  const args = buildTmFilters(filters).join(",\n    ");
  const dax = `
EVALUATE
CALCULATETABLE(
  ROW(
    "Job Display", [Job Display],
    "Part Invoiced Amount", [Part Invoiced Amount],
    "SDC Manufactured Parts Sales Price", [SDC Manufactured Parts Sales Price],
    "Expense Reports", [Expense Reports]
  ),
    ${args}
)`;
  const rows = (await runDax(dax)) as Record<string, unknown>[];
  const row = rows[0] ?? {};
  return {
    jobDisplay: String(row["Job Display"] ?? ""),
    partInvoicedAmount: num(row["Part Invoiced Amount"]),
    sdcManufacturedPartsSalesPrice: num(row["SDC Manufactured Parts Sales Price"]),
    expenseReports: num(row["Expense Reports"]),
  };
}

// ── Drill-through row-level detail (Parts cards only) ───────────────────────
//
// One DAX query per card, reusing buildTmFilters() — the exact filter
// context fetchTmMetrics already applies for the same card — plus, for two
// of the three, the one extra filter condition lifted verbatim from that
// card's own measure (see the DAX quoted below). Same filtered source rows
// in, same filtered source rows out: summing a card's own reconciling column
// across every row this returns must equal the KPI value fetchTmMetrics
// returned for the same selection. Never add a filter or exclusion here that
// isn't in the measure itself.

export type TmPartsDrillKey = "partInvoicedAmount" | "sdcManufacturedPartsSalesPrice" | "expenseReports";

export type TmPartsDrillRow = {
  jobId: string;
  jobName: string;
  partNumber: string;
  description: string;
  supplier: string;
  poNumber: string;
  purchaseDate: string | null;
  invoicedDate: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  invoicedAmount: number;
};

// measure 'Part Invoiced Amount'               = sum('Part Purchase'[Invoiced Amount])
// measure 'SDC Manufactured Parts Sales Price' = CALCULATE(SUM('Part Purchase'[Total Price]), REMOVEFILTERS(...), 'Part Purchase'[Manufacturer] = "SDC", 'Part Purchase'[Supplier] = "Steven Douglas Corp.")
// measure 'Expense Reports'                    = CALCULATE(SUM('Part Purchase'[Total Price]), SEARCH("expense reports", 'Part Purchase'[Supplier], 1, 0) > 0)
//
// "Expense Reports" is NOT the model's separate 'Travel Expenses' table (real
// employee expense reports, with no Job/Date-range relationship to this page's
// filters at all) — despite the name, the measure is a text-matched subset of
// 'Part Purchase' rows whose AP vendor name contains "expense reports". Using
// 'Travel Expenses' here would show the wrong data and wouldn't reconcile.
const PARTS_DRILL_FILTER: Record<TmPartsDrillKey, string | null> = {
  partInvoicedAmount: null,
  sdcManufacturedPartsSalesPrice: `'Part Purchase'[Manufacturer] = "SDC" && 'Part Purchase'[Supplier] = "Steven Douglas Corp."`,
  expenseReports: `SEARCH("expense reports", 'Part Purchase'[Supplier], 1, 0) > 0`,
};

// 'Part Purchase' is already row-grain (one PO/AP line per row), so this is a
// straight SELECTCOLUMNS projection rather than an aggregation — every column
// aliased, so every key below comes back as its plain alias text (confirmed
// by job-hours-source.ts's own buildColumnResolver, the existing precedent
// for an aliased SELECTCOLUMNS query in this codebase). Exported so
// tests/tm-report.test.ts can assert its shape without a live Power BI
// connection.
export function buildTmPartsDrillDax(filters: TmFilters, key: TmPartsDrillKey): string {
  const extra = PARTS_DRILL_FILTER[key];
  const args = (extra ? [...buildTmFilters(filters), extra] : buildTmFilters(filters)).join(",\n    ");
  return `
EVALUATE
CALCULATETABLE(
  SELECTCOLUMNS(
    'Part Purchase',
    "Job Id", 'Part Purchase'[Job ID],
    "Job Name", RELATED('Job'[Job Name]),
    "Part Number", 'Part Purchase'[Part Number],
    "Description", 'Part Purchase'[Description],
    "Supplier", 'Part Purchase'[Supplier],
    "PO Number", 'Part Purchase'[PO Number],
    "Purchase Date", 'Part Purchase'[Purchase Date],
    "Invoiced Date", 'Part Purchase'[Invoiced Date],
    "Quantity", 'Part Purchase'[Quantity],
    "Unit Price", 'Part Purchase'[Purchase Price],
    "Total Price", 'Part Purchase'[Total Price],
    "Invoiced Amount", 'Part Purchase'[Invoiced Amount]
  ),
    ${args}
)`;
}

export async function fetchTmPartsDrill(filters: TmFilters, key: TmPartsDrillKey): Promise<TmPartsDrillRow[]> {
  const dax = buildTmPartsDrillDax(filters, key);
  const rows = (await runDax(dax)) as Record<string, unknown>[];
  return rows.map((r) => ({
    jobId: normalizePbiJobId(String(r["Job Id"] ?? "")),
    jobName: String(r["Job Name"] ?? ""),
    partNumber: String(r["Part Number"] ?? ""),
    description: String(r["Description"] ?? ""),
    supplier: String(r["Supplier"] ?? ""),
    poNumber: String(r["PO Number"] ?? ""),
    purchaseDate: toIsoDateOrNull(r["Purchase Date"]),
    invoicedDate: toIsoDateOrNull(r["Invoiced Date"]),
    quantity: num(r["Quantity"]),
    unitPrice: num(r["Unit Price"]),
    totalPrice: num(r["Total Price"]),
    invoicedAmount: num(r["Invoiced Amount"]),
  }));
}

// The reconciliation check (KPI Total / Detail Total / Difference) lives in
// tm-drill-reconcile.ts, NOT here — this file imports runDax (a Node-only
// Power BI client pulling in @azure/msal-node/keytar/fs) at module scope, so
// anything imported BY VALUE from here drags that whole chain into whatever
// bundle imports it. The reconciliation check is read from a client
// component (TmReportClient.tsx) for its dev-only console log, which broke
// the production build the one time these lived in this file together:
// Turbopack tried to put keytar's native binary and Node's `fs`/`module`
// into a browser chunk. Every OTHER export in this file is fine to stay
// value-imported only from server components/actions (tm/page.tsx,
// tm-drill-actions.ts) — see those two files' own imports for the pattern
// client code must keep instead (`import type` only from this file).

// Prefills the two date pickers on first load only — not part of the
// displayed metrics, and never used to filter them.
export async function fetchTmDateDefaults(): Promise<TmDateDefaults> {
  const dax = `EVALUATE ROW("AsOf", [Estimated to Complete As Of Date], "RefreshedThru", [Hours Refreshed Thru])`;
  const rows = (await runDax(dax)) as Record<string, unknown>[];
  const row = rows[0] ?? {};
  const toIso = (value: unknown): string | null => {
    if (!value) return null;
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  };
  return { asOfDate: toIso(row["AsOf"]), hoursRefreshedThru: toIso(row["RefreshedThru"]) };
}
