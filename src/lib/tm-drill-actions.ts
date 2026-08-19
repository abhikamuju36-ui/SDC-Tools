"use server";

import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { fetchTmPartsDrill, type TmPartsDrillKey, type TmPartsDrillRow } from "@/lib/tm-report";
import { getTmHoursDrillRows, resolveTmJobPks, type TmHoursDrillKey, type TmHoursDrillRow } from "@/lib/tm-hours";
import { sanitizeJobIds, isValidDateRange } from "@/lib/tm-drill-validate";

// The T&M KPI cards' drill-through, fetched WHEN A CARD IS CLICKED — same
// reasoning as loadEtcMonthHoursDetail/loadPartsSpentDetail in
// hours-detail-actions.ts: this is real I/O, not a page-load concern, for a
// panel most sessions never open.
//
// Two different backends behind these two actions, by design (2026-08-19):
// the four Hours cards read the app's own local Paylocity ingest (same
// pipeline Monthly ETC's hours already use — see tm-hours.ts's header), the
// three dollar cards still read live Power BI. Nothing here should ever
// route an hours key through fetchTmPartsDrill or vice versa — the two
// HOURS_KEYS/PARTS_KEYS lists exist specifically to keep that boundary a
// runtime-checked fact, not just a convention. Neither path falls back to
// the other on failure — an hours query that fails stays failed rather than
// silently re-querying Power BI, which would make the runtime source
// selection unpredictable and defeat the whole point of moving off it.
//
// ── Failures are logged here, not shown here (2026-08-19) ───────────────────
//
// A raw Prisma error can name a table/column; a raw Power BI DAX error can be
// startlingly detailed about the model's own internals (see
// docs/SEMANTIC-MODEL-MAP.md's `Hours Actual` example). Neither belongs in
// front of a user. `withDrillLogging` is the one seam both actions go
// through: it logs the full exception server-side with enough context to
// actually debug an intermittent failure (metric, job selection, date range,
// which source, how long it ran, a request id), and hands the CLIENT back
// only a generic message plus that request id for correlating a support
// report to this exact log line.

const HOURS_KEYS: TmHoursDrillKey[] = ["engineeringHours", "shopHours", "pmHours", "manufacturingHours"];
const PARTS_KEYS: TmPartsDrillKey[] = ["partInvoicedAmount", "sdcManufacturedPartsSalesPrice", "expenseReports"];

function requireDateRange(startDate: string, endDate: string): void {
  if (!isValidDateRange(startDate, endDate)) throw new Error("Invalid date range.");
}

type DrillSource = "paylocity" | "powerbi";

async function withDrillLogging<T>(params: {
  metric: TmHoursDrillKey | TmPartsDrillKey;
  jobIds: string[];
  startDate: string;
  endDate: string;
  source: DrillSource;
  run: () => Promise<T>;
}): Promise<T> {
  const requestId = randomUUID();
  const startedAt = Date.now();
  try {
    return await params.run();
  } catch (error) {
    console.error("[tm-drill] query failed", {
      requestId,
      metric: params.metric,
      jobIds: params.jobIds,
      startDate: params.startDate,
      endDate: params.endDate,
      source: params.source,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
    });
    // Deliberately generic — see this file's header. The request id is the
    // only thing carried through to the UI, so a user reporting "detail ref
    // <id> failed" points straight at the log line above.
    throw new Error(`Couldn't load this detail. (ref ${requestId})`);
  }
}

export async function loadTmHoursDrill(
  key: TmHoursDrillKey,
  jobIds: string[],
  startDate: string,
  endDate: string,
): Promise<TmHoursDrillRow[]> {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in.");
  if (!HOURS_KEYS.includes(key)) throw new Error(`Invalid drill key "${key}".`);
  requireDateRange(startDate, endDate);
  const cleanJobIds = sanitizeJobIds(jobIds);
  return withDrillLogging({
    metric: key,
    jobIds: cleanJobIds,
    startDate,
    endDate,
    source: "paylocity",
    run: async () => {
      const jobPks = await resolveTmJobPks(cleanJobIds);
      // `truncated` isn't surfaced to the panel today — MAX_ROWS (4000) is far
      // above any real job/date-range selection; if it's ever hit in practice,
      // the dev-only reconciliation check (TmReportClient.tsx) will show a
      // nonzero difference, which is the signal to add a "truncated" note here.
      const { rows } = await getTmHoursDrillRows(jobPks, startDate, endDate, key);
      return rows;
    },
  });
}

export async function loadTmPartsDrill(
  key: TmPartsDrillKey,
  jobIds: string[],
  startDate: string,
  endDate: string,
): Promise<TmPartsDrillRow[]> {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in.");
  if (!PARTS_KEYS.includes(key)) throw new Error(`Invalid drill key "${key}".`);
  requireDateRange(startDate, endDate);
  const cleanJobIds = sanitizeJobIds(jobIds);
  return withDrillLogging({
    metric: key,
    jobIds: cleanJobIds,
    startDate,
    endDate,
    source: "powerbi",
    run: () => fetchTmPartsDrill({ jobIds: cleanJobIds, startDate, endDate }, key),
  });
}
