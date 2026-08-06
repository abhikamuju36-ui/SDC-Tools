import "server-only";

import {
  buildColumnResolver,
  fetchJobHoursRowsWithIssues,
  type HoursImportIssue,
  type JobHoursRow,
  type PoolHoursByMonth,
} from "@/lib/job-hours-source";
import {
  readPaylocityWorkbook,
  workbookPath,
  WorkbookError,
  type RejectedPunch,
  type WorkbookIdentity,
} from "@/lib/paylocity-workbook";
import { aggregateUndefined, countsAsUndefined, type UndefinedReason } from "@/lib/undefined-hours-rules";
import { prisma } from "@/lib/prisma";

// ── THE hours feed (§42.8, §42.14) ──────────────────────────────────────────
//
// One entry point for "what hours were worked". Everything downstream — the ETC
// grid's Hours Worked Month, the job rollups, the punch drill, the Standard Fees
// pools, the KPI cards, the exports, submission validation — reaches the source
// through here and nowhere else.
//
// That centralisation is the §42.8 requirement, and it is also the only way the
// §42.11 reconciliation can hold: the Undefined Hours KPI and its drill-through are
// now two views of ONE computation performed here, rather than two computations that
// happened to agree. They previously did not — the card read a stored table and the
// drill ran a live query, and unattributed-hours.ts documented the divergence as an
// accepted trade-off. It is no longer a trade-off anybody has to accept.
//
// ── Which source, and why not a fallback ────────────────────────────────────
//
// The workbook is authoritative for the months it covers. Power BI remains the
// source only for months the workbook does not reach (it starts at 2026-01; the
// model holds 2025-02 onward), and that is a PARTITION BY MONTH, not a fallback.
//
// There is deliberately no fall back to Power BI when the workbook fails. It looks
// like resilience and is the opposite: the model runs days behind the file (July was
// short 150.53h, August entirely absent — see paylocity-workbook.ts), so falling back
// would overwrite fresh figures with stale ones and produce exactly the "mixed old
// and new metrics" §42.19 forbids. A failed read raises, the sync step records the
// failure, and the last valid dataset stays on screen untouched.
//
// HOURS_SOURCE=power_bi forces the old path. An operational escape hatch — if the
// OneDrive folder is unavailable for a day and somebody decides stale-but-present
// beats absent, that is a human decision made deliberately, not one this module
// makes silently on their behalf.

export type HoursFeedSource = "workbook" | "power_bi";

export type HoursProvenance = {
  source: HoursFeedSource;
  // Null when the source is Power BI.
  workbook: WorkbookIdentity | null;
  // Months the source actually carried data for.
  monthsCovered: string[];
  // Latest work date seen — the "Hours Refreshed Thru" figure, and the number that
  // makes staleness visible instead of inferred.
  lastWorkDate: Date | null;
  // Why the chosen source was chosen, in words a refresh log can print.
  note: string;
};

export type HoursFeed = {
  rows: JobHoursRow[];
  // Per month/label totals — the aggregate the KPI card reads.
  issues: HoursImportIssue[];
  // Punch-level rejections with a reason each — what the drill-through shows.
  // DERIVED FROM THE SAME PASS as `issues`, which is what guarantees they foot.
  rejected: RejectedPunch[];
  poolHours: PoolHoursByMonth;
  provenance: HoursProvenance;
};

export function configuredSource(): HoursFeedSource {
  return process.env.HOURS_SOURCE?.trim() === "power_bi" ? "power_bi" : "workbook";
}

// The Undefined Hours rules come from lib/undefined-hours-rules.ts and are re-exported
// here so callers that already reach for the feed do not need a second import. There is
// one implementation; this is a doorway, not a copy.
export { countsAsUndefined, aggregateUndefined };

// The job numbers the app knows about, so a numerically-valid job it has never heard
// of is reported rather than silently dropped (§42.7). Read once per feed rather than
// per row.
async function knownJobNumbers(): Promise<Set<string>> {
  const jobs = await prisma.job.findMany({ select: { jobId: true } });
  return new Set(jobs.map((j) => j.jobId));
}

// The model's code -> app column map. Static metadata (what a punch code MEANS), not
// hours, so reading it from Power BI is not a contradiction with sourcing hours from
// the file. Falls back to the hand-written SECTION_ALIASES exactly as before, so a
// Power BI outage costs the newest code mappings and never a single hour.
async function columnResolver(): Promise<((s: string) => string | null) | undefined> {
  try {
    const built = await buildColumnResolver();
    return built.resolve;
  } catch (err) {
    console.warn("[hours-feed] Function Hierarchy unavailable; falling back to SECTION_ALIASES:", err);
    return undefined;
  }
}

/**
 * Read the hours feed.
 *
 * Throws a {@link WorkbookError} when the configured workbook cannot be used. That is
 * deliberate and is the §42.19 contract: the caller must abort and leave the last
 * valid dataset in place rather than write something partial.
 */
export async function readHoursFeed(opts?: { onlyMonth?: string }): Promise<HoursFeed> {
  const source = configuredSource();

  if (source === "power_bi") {
    return readFromPowerBi(opts?.onlyMonth, "HOURS_SOURCE=power_bi — reading the Power BI model by explicit configuration.");
  }

  const [resolve, known] = await Promise.all([columnResolver(), knownJobNumbers()]);
  const wbk = await readPaylocityWorkbook({ resolve, knownJobNumbers: known, onlyMonth: opts?.onlyMonth });

  return {
    rows: wbk.rows,
    issues: aggregateUndefined(wbk.rejected),
    rejected: wbk.rejected,
    poolHours: wbk.poolHours,
    provenance: {
      source: "workbook",
      workbook: wbk.identity,
      monthsCovered: wbk.monthsCovered,
      lastWorkDate: wbk.lastWorkDate,
      note:
        `${wbk.identity.fileName} (${wbk.identity.size.toLocaleString()} bytes, modified ` +
        `${wbk.identity.modifiedAt.toISOString().replace("T", " ").slice(0, 16)}Z), ` +
        `${wbk.stats.rowsWithHours.toLocaleString()} rows with hours through ${wbk.lastWorkDate?.toISOString().slice(0, 10) ?? "—"}.`,
    },
  };
}

// The pre-2026-08-05 path, kept whole. Reached only by explicit configuration, and by
// the historical-backfill scripts that legitimately need months the workbook does not
// carry.
export async function readFromPowerBi(onlyMonth?: string, note?: string): Promise<HoursFeed> {
  const { rows, issues, unattributed, poolHours } = await fetchJobHoursRowsWithIssues({ onlyMonth });
  // Power BI's reader predates the reason vocabulary; everything it rejects it rejects
  // for one cause — the job cell is not a job number — so that is what it is labelled.
  // Mapped rather than left empty so the drill renders identically whichever source
  // produced the data.
  const rejected: RejectedPunch[] = unattributed.map((u) => ({
    month: u.month,
    reason: (Number.isFinite(Number(u.label)) && u.label !== "(blank)" ? "JOB_NOT_FOUND" : u.label === "(blank)" ? "MISSING_JOB_ID" : "JOB_NOT_FOUND") as UndefinedReason,
    label: u.label,
    workDate: u.date,
    employeeId: u.employeeId,
    section: u.section,
    hours: u.hours,
    sourceRow: 0, // the model has no row numbers
    countsTowardKpi: true, // by construction: this reader only reports what counted
  }));
  let last: Date | null = null;
  for (const r of rows) if (!last || r.date > last) last = r.date;
  const months = [...new Set(rows.map((r) => `${r.year}-${String(r.month).padStart(2, "0")}`))].sort();
  return {
    rows,
    issues,
    rejected,
    poolHours,
    provenance: {
      source: "power_bi",
      workbook: null,
      monthsCovered: months,
      lastWorkDate: last,
      note: note ?? `Power BI 'Hours Actual' (Paylocity Hours), ${rows.length.toLocaleString()} rows through ${last?.toISOString().slice(0, 10) ?? "—"}.`,
    },
  };
}

// A one-line description of where hours came from and how current they are, for the
// refresh record and the ETC header. Stated rather than inferred, because "the number
// looks plausible" is how staleness survives.
export function describeProvenance(p: HoursProvenance): string {
  const thru = p.lastWorkDate ? p.lastWorkDate.toISOString().slice(0, 10) : "unknown";
  return p.source === "workbook"
    ? `Paylocity workbook — hours through ${thru}`
    : `Power BI model — hours through ${thru}`;
}

export { WorkbookError, workbookPath };
export type { RejectedPunch, UndefinedReason, WorkbookIdentity };
