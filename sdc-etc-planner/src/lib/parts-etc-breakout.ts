import "server-only";
import { getPartsCostForJobs, type PartsCostLine } from "@/lib/sync-totaleto";
import { getJobBom } from "@/lib/job-bom";
import { flattenBomParts } from "@/lib/po-detail";
import { mapWithConcurrency } from "@/lib/map-concurrent";
import { withTimeoutOrNull, UPSTREAM_BUDGET_MS } from "@/lib/with-timeout";

// ── Breaking the Parts Cost New ETC into its two halves ──────────────────────
//
// Asked for 2026-09-03: show, per job, on the Monthly ETC grid —
//
//     Left to Invoice   already on a purchase order, not yet invoiced
//     Left to Purchase  on the BOM, not bought yet
//
// and seed New ETC from their sum, still editable.
//
// ── Why this file exists rather than the page fetching inline ───────────────
//
// The Monthly ETC page makes NO upstream calls today. Every Parts Cost figure on it
// comes from EtcEntry — prior ETC, money spent, New ETC — so it is pure app-database
// reads. These two columns are the first thing on that page to need Total ETO, and
// the page is the heaviest in the app: 2,235 lines, and its PM2 memory ceiling was
// raised to 1536M because the hourly refresh already peaks near 800MB.
//
// Getting that wrong takes down the page managers use to close the month, so the
// safety is the substance of this file rather than a wrapper round it.
//
// ── The two halves cost wildly different amounts ────────────────────────────
//
//   Left to Invoice   ONE batched query. getPartsCostForJobs takes every job number
//                     at once (`ProjectID IN (…)`), so 49 jobs cost one round trip.
//                     Cheap enough to be unremarkable.
//
//   Left to Purchase  Needs the BOM, because a part nobody has bought yet does not
//                     appear in the PO/AP lines AT ALL — that is what "not bought"
//                     means. getJobBom is per job, so this is 49 calls, and measured
//                     2026-08-06 a single getJobBom once took 101.7 seconds.
//
// So the second half is the one that needs a leash, and it gets three:
//
//   1. Bounded fan-out (BOM_CONCURRENCY). 49 simultaneous requests is a way to take
//      Total ETO down, not a way to be fast.
//   2. A per-call timeout. One pathological job cannot hold a worker forever.
//   3. A SHARED DEADLINE across the whole batch — the one that actually matters.
//      Without it the worst case is (49 / 6) waves x 12s ≈ 108 seconds, because
//      per-call timeouts multiply across waves. Once the deadline passes, remaining
//      jobs are not attempted and report null.
//
// null means "we could not find out", and every caller must render it as "—" rather
// than as 0. A zero here would read as "nothing left to buy", which is the opposite
// of not knowing, on a figure that seeds the manager's forecast.

/** At most this many BOM reads in flight. Matches the fan-out getPartsCostFinancials uses. */
const BOM_CONCURRENCY = 6;

/**
 * The whole batch's budget. Past this, remaining jobs report null rather than being
 * attempted.
 *
 * 20s is chosen against what the page costs WITHOUT this work — app-database reads in
 * the tens of milliseconds — so the ceiling on the regression is explicit and bounded
 * rather than emergent. It is deliberately not generous: a manager closing the month
 * would rather see "—" on two columns than wait.
 */
const BATCH_BUDGET_MS = 20_000;

export type PartsEtcBreakout = {
  /** Purchased − invoiced, from Total ETO. Null when the lines could not be read. */
  leftToInvoice: number | null;
  /** BOM parts with no purchase line, priced unit × qty. Null when the BOM could not be read. */
  leftToPurchase: number | null;
};

export type PartsEtcBreakoutResult = {
  byJobPk: Map<number, PartsEtcBreakout>;
  /** True when the batched parts-lines query failed, so no Left to Invoice is known. */
  linesFailed: boolean;
  /** How many jobs could not have a BOM read — timed out, errored, or ran out of budget. */
  bomUnavailable: number;
  /** How many jobs were skipped because the batch deadline had already passed. */
  bomSkipped: number;
};

const EMPTY: PartsEtcBreakout = { leftToInvoice: null, leftToPurchase: null };

/**
 * Both halves for a month's jobs.
 *
 * `jobs` pairs the internal PK (what the grid is keyed by) with the job NUMBER (what
 * Total ETO is keyed by). Returning a map keyed by PK keeps the caller from having to
 * hold that translation.
 *
 * Never throws. A total upstream failure yields nulls throughout and the grid renders
 * "—", which is the same shape as one job failing.
 */
export async function readPartsEtcBreakout(
  jobs: readonly { pk: number; jobNumber: string }[],
): Promise<PartsEtcBreakoutResult> {
  const byJobPk = new Map<number, PartsEtcBreakout>();
  for (const j of jobs) byJobPk.set(j.pk, { ...EMPTY });
  if (jobs.length === 0) return { byJobPk, linesFailed: false, bomUnavailable: 0, bomSkipped: 0 };

  const deadline = Date.now() + BATCH_BUDGET_MS;
  const remaining = () => deadline - Date.now();

  // ── Half one: Left to Invoice, one batched query ──────────────────────────
  const jobNumbers = [...new Set(jobs.map((j) => j.jobNumber).filter(Boolean))];
  const linesByJob = await withTimeoutOrNull(
    `TotalETO parts lines (${jobNumbers.length} jobs, ETC grid)`,
    Math.min(UPSTREAM_BUDGET_MS, Math.max(1_000, remaining())),
    () => getPartsCostForJobs(jobNumbers),
    (e) => console.error("[parts-etc-breakout] batched parts lines failed:", e),
  );

  for (const j of jobs) {
    // ── Absent from the map is ZERO, not unknown (fixed 2026-09-03) ─────────
    //
    // getPartsCostForJobs only returns an entry for a job that HAS lines, so a job
    // with nothing purchased yet is simply missing from the map. This used to
    // `continue`, leaving leftToInvoice null — and measured on 2026-08, 6 of 49 jobs
    // fell into it and lost their New ETC seed entirely.
    //
    // That conflated two different things. If the batched query SUCCEEDED, a job with
    // no lines has nothing on order: its Left to Invoice is $0, a real answer. Only a
    // FAILED query means unknown, and that is handled separately below.
    if (linesByJob == null) continue;
    const lines = linesByJob.get(j.jobNumber) ?? [];
    // Floored on the AGGREGATE, matching every other place this figure is computed: a
    // line whose posted spend exceeds its purchased total is a credit and should net
    // against its neighbours rather than being clamped away on its own.
    const left = lines.reduce((a, l) => a + (l.totalPrice - l.actualAmount), 0);
    byJobPk.set(j.pk, { ...(byJobPk.get(j.pk) ?? EMPTY), leftToInvoice: Math.max(0, left) });
  }

  // ── Half two: Left to Purchase, leashed ───────────────────────────────────
  //
  // Skipped entirely when the parts lines could not be read: `flattenBomParts` needs
  // them to decide which BOM parts HAVE been bought, so without them every part would
  // look unbought and the column would report the whole BOM as still to buy — a wrong
  // number rather than a missing one.
  let bomUnavailable = 0;
  let bomSkipped = 0;

  if (!linesByJob) {
    bomUnavailable = jobs.length;
    return { byJobPk, linesFailed: true, bomUnavailable, bomSkipped };
  }

  await mapWithConcurrency(jobs, BOM_CONCURRENCY, async (j) => {
    // The shared deadline, checked before starting rather than after waiting. This is
    // what stops per-call timeouts from multiplying across waves.
    const left = remaining();
    if (left <= 500) {
      bomSkipped++;
      bomUnavailable++;
      return;
    }
    const bom = await withTimeoutOrNull(
      `TotalETO BOM ${j.jobNumber}`,
      Math.min(UPSTREAM_BUDGET_MS, left),
      () => getJobBom(j.jobNumber),
      // Per-job and quiet: on a 49-job grid one unreachable job is ordinary, and a
      // stack trace each would bury the batch summary the caller actually logs.
      () => {},
    );
    if (!bom) {
      bomUnavailable++;
      return;
    }
    const lines: PartsCostLine[] = linesByJob.get(j.jobNumber) ?? [];
    // `matchReason === "no-purchase"` is po-detail.ts's own name for a BOM part with
    // no purchase line against it, and for exactly those rows `totalPrice` is the BOM
    // price (unit × qty) rather than spend. Reusing that rather than re-deriving it
    // keeps this column and the Parts List's own "NOT BOUGHT" rows in agreement.
    let toPurchase = 0;
    for (const p of flattenBomParts(bom, lines)) {
      if (p.matchReason === "no-purchase") toPurchase += p.totalPrice;
    }
    byJobPk.set(j.pk, { ...(byJobPk.get(j.pk) ?? EMPTY), leftToPurchase: Math.max(0, toPurchase) });
  });

  if (bomUnavailable > 0) {
    console.warn(
      `[parts-etc-breakout] Left to Purchase unavailable for ${bomUnavailable}/${jobs.length} jobs` +
        (bomSkipped > 0 ? ` (${bomSkipped} skipped once the ${BATCH_BUDGET_MS}ms batch budget ran out)` : ""),
    );
  }

  return { byJobPk, linesFailed: false, bomUnavailable, bomSkipped };
}

/**
 * The seed for the New ETC cell: the two halves added together.
 *
 * Null when either half is unknown — a sum that silently treats a missing half as
 * zero would seed the manager's forecast too low, and the cell falls back to its
 * existing carry-forward suggestion instead.
 */
export function breakoutSeed(b: PartsEtcBreakout | undefined): number | null {
  if (!b || b.leftToInvoice == null || b.leftToPurchase == null) return null;
  return b.leftToInvoice + b.leftToPurchase;
}
