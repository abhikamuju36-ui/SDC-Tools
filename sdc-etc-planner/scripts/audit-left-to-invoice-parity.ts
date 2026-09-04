import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getPartsCostForJobs, type PartsCostLine } from "../src/lib/sync-totaleto";
import { PARTS_COST_SECTION } from "../src/lib/sections";
import { leftToInvoiceForLines, monthEndCutoff, explainLeftToInvoice } from "../src/lib/left-to-invoice";

// ── Why Monthly ETC's Left to Invoice and the Parts List disagree ────────────
//
//   npx tsx -r ./scripts/shim-server-only.cjs scripts/audit-left-to-invoice-parity.ts 2026-08
//
// Measures every candidate definition against the SAME rows, so the size of each
// difference is a number rather than an argument. Read-only.

const month = process.argv[2] ?? "2026-08";
const endOfMonth = (m: string) => {
  const [y, mm] = m.split("-").map(Number);
  return `${y}-${String(mm).padStart(2, "0")}-${String(new Date(y, mm, 0).getDate()).padStart(2, "0")}`;
};
const END = endOfMonth(month);
const day = (d: string | null) => (d ? d.slice(0, 10) : null);
const usd = (n: number) => (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Every definition in play, over one job's lines.
const defs = {
  /** What Monthly ETC ships NOW — the shared function with this month's cutoff. */
  etcShipped: (ls: PartsCostLine[]) => leftToInvoiceForLines(ls, { asOf: monthEndCutoff(month) }),
  /** What it shipped BEFORE the fix: lifetime, no cutoff. */
  etcToday: (ls: PartsCostLine[]) => Math.max(0, ls.reduce((a, l) => a + (l.totalPrice - l.actualAmount), 0)),
  /** Same, unfloored — isolates how much the floor is doing. */
  etcUnfloored: (ls: PartsCostLine[]) => ls.reduce((a, l) => a + (l.totalPrice - l.actualAmount), 0),
  /** invoicedAmount (billed) instead of actualAmount (GL-posted). */
  billedBasis: (ls: PartsCostLine[]) => ls.reduce((a, l) => a + (l.totalPrice - l.invoicedAmount), 0),
  /** Parts List with a PURCHASE-date cutoff: drop lines purchased after month end. */
  purchaseCutoff: (ls: PartsCostLine[]) =>
    ls.filter((l) => day(l.purchaseDate) !== null && day(l.purchaseDate)! <= END).reduce((a, l) => a + (l.totalPrice - l.actualAmount), 0),
  /** Purchase cutoff AND an invoice not yet posted as of month end counts as 0. */
  asOfSnapshot: (ls: PartsCostLine[]) =>
    ls
      .filter((l) => day(l.purchaseDate) !== null && day(l.purchaseDate)! <= END)
      .reduce((a, l) => a + (l.totalPrice - (day(l.invoicedDate) !== null && day(l.invoicedDate)! <= END ? l.actualAmount : 0)), 0),
  /** Lines with NO purchase date at all — what a Parts List date filter silently drops. */
  droppedNoPurchaseDate: (ls: PartsCostLine[]) =>
    ls.filter((l) => day(l.purchaseDate) === null).reduce((a, l) => a + (l.totalPrice - l.actualAmount), 0),
  /** Lines purchased AFTER month end — leakage from the future into a closed month. */
  purchasedAfter: (ls: PartsCostLine[]) =>
    ls.filter((l) => (day(l.purchaseDate) ?? "") > END).reduce((a, l) => a + (l.totalPrice - l.actualAmount), 0),
  /** Actual posted AFTER month end against a line purchased on/before it. */
  postedAfter: (ls: PartsCostLine[]) =>
    ls
      .filter((l) => day(l.purchaseDate) !== null && day(l.purchaseDate)! <= END && (day(l.invoicedDate) ?? "") > END)
      .reduce((a, l) => a + l.actualAmount, 0),
};

async function main() {
  const entries = await prisma.etcEntry.findMany({
    where: { month, section: PARTS_COST_SECTION },
    select: { jobId: true },
  });
  const jobs = await prisma.job.findMany({
    where: { id: { in: [...new Set(entries.map((e) => e.jobId))] } },
    select: { id: true, jobId: true, jobName: true },
  });
  const withNumbers = jobs.filter((j) => j.jobId);
  console.log(`\nMonth ${month} (cutoff ${END}) · ${withNumbers.length} Parts Cost jobs\n`);

  const byJob = await getPartsCostForJobs(withNumbers.map((j) => j.jobId));

  const totals: Record<string, number> = {};
  const rows: { job: string; name: string; lines: number; vals: Record<string, number> }[] = [];
  for (const j of withNumbers) {
    const ls = byJob.get(j.jobId) ?? [];
    const vals: Record<string, number> = {};
    for (const [k, fn] of Object.entries(defs)) {
      vals[k] = fn(ls);
      totals[k] = (totals[k] ?? 0) + vals[k];
    }
    rows.push({ job: j.jobId, name: (j.jobName ?? "").slice(0, 34), lines: ls.length, vals });
  }

  const keys = Object.keys(defs);
  console.log("TOTALS across every job");
  for (const k of keys) console.log(`  ${k.padEnd(24)} ${usd(totals[k]).padStart(16)}`);

  // THE parity check, on live data: what Monthly ETC now renders vs the Parts List
  // rule, per job and in total.
  let worstDelta = 0;
  let worstJob = "";
  for (const r of rows) {
    const d = Math.abs(r.vals.etcShipped - Math.max(0, r.vals.purchaseCutoff));
    if (d > worstDelta) { worstDelta = d; worstJob = r.job; }
  }
  const shippedTotal = rows.reduce((a, r) => a + r.vals.etcShipped, 0);
  const listTotal = rows.reduce((a, r) => a + Math.max(0, r.vals.purchaseCutoff), 0);
  console.log("");
  console.log(`PARITY: shipped Monthly ETC vs Parts List through ${END}`);
  console.log(`  Monthly ETC total ${usd(shippedTotal)}    Parts List total ${usd(listTotal)}`);
  console.log(`  worst per-job delta ${usd(worstDelta)}${worstJob ? " (job " + worstJob + ")" : ""}`);
  if (worstDelta > 0.005) {
    const x = explainLeftToInvoice(byJob.get(worstJob) ?? [], { asOf: monthEndCutoff(month) });
    console.log(`  job ${worstJob}: raw ${usd(x.raw)}, floored ${usd(x.total)}, ${x.linesIncluded} in / ${x.linesExcluded} out`);
    for (const e of x.excludedByCutoff.slice(0, 5)) console.log(`    excluded PO ${e.poNumber} ${e.partNumber} ${e.purchaseDate} ${usd(e.amount)}`);
  }
  console.log("");

  // Which jobs the aggregate floor actually bites on, and which carry postings dated
  // after the cutoff. These are the two documented remaining differences; naming the
  // jobs is the difference between a caveat and a fact.
  const negative = rows.filter((r) => r.vals.purchaseCutoff < -0.005);
  console.log(`FLOOR: ${negative.length} job(s) sit below zero before flooring`);
  for (const r of negative) {
    console.log(`  job ${r.job.padEnd(6)} raw ${usd(r.vals.purchaseCutoff).padStart(14)} -> shown ${usd(r.vals.etcShipped).padStart(12)}   ${r.name}`);
  }
  console.log(`  total floor effect ${usd(negative.reduce((a, r) => a - r.vals.purchaseCutoff, 0))}`);

  const drifting = rows
    .map((r) => ({ ...r, late: r.vals.asOfSnapshot - r.vals.purchaseCutoff }))
    .filter((r) => Math.abs(r.late) > 0.005)
    .sort((a, b) => b.late - a.late);
  console.log(`
DRIFT: ${drifting.length} job(s) have GL postings dated after ${END}`);
  for (const r of drifting.slice(0, 8)) {
    console.log(`  job ${r.job.padEnd(6)} shown ${usd(r.vals.etcShipped).padStart(14)}  frozen ${usd(Math.max(0, r.vals.asOfSnapshot)).padStart(14)}  late postings ${usd(r.late).padStart(13)}   ${r.name}`);
  }
  console.log("");

  const gap = totals.etcToday - totals.purchaseCutoff;
  console.log(`\n  etcToday − purchaseCutoff = ${usd(gap)}`);
  console.log(`  of which purchased after ${END}: ${usd(totals.purchasedAfter)}`);
  console.log(`  lines with no purchase date at all: ${usd(totals.droppedNoPurchaseDate)}`);
  console.log(`  actual posted after ${END} on lines purchased before it: ${usd(totals.postedAfter)}`);
  console.log(`  floor effect (etcToday − etcUnfloored): ${usd(totals.etcToday - totals.etcUnfloored)}`);
  console.log(`  basis effect (billed − GL-posted): ${usd(totals.billedBasis - totals.etcUnfloored)}`);

  const moved = rows
    .map((r) => ({ ...r, d: r.vals.etcToday - r.vals.purchaseCutoff }))
    .filter((r) => Math.abs(r.d) > 0.005)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  console.log(`\n${moved.length} of ${rows.length} jobs move. Largest 15:\n`);
  console.log(
    "  JOB   LINES  " + "etcToday".padStart(14) + "purchaseCut".padStart(15) + "asOfSnapshot".padStart(15) + "diff".padStart(14) + "  NAME",
  );
  for (const r of moved.slice(0, 15)) {
    console.log(
      `  ${r.job.padEnd(6)}${String(r.lines).padStart(5)}  ${usd(r.vals.etcToday).padStart(14)}${usd(r.vals.purchaseCutoff).padStart(15)}${usd(r.vals.asOfSnapshot).padStart(15)}${usd(r.d).padStart(14)}  ${r.name}`,
    );
  }

  // The offending rows themselves, for the worst job — so a mismatch names lines.
  const worst = moved[0];
  if (worst) {
    const ls = byJob.get(worst.job) ?? [];
    const bad = ls.filter((l) => day(l.purchaseDate) === null || day(l.purchaseDate)! > END);
    console.log(`\nJob ${worst.job}: ${bad.length} line(s) excluded by the ${END} purchase cutoff\n`);
    for (const l of bad.slice(0, 12)) {
      console.log(
        `  PO ${String(l.poNumber ?? "—").padEnd(12)} ${String(l.partNumber ?? "—").padEnd(22)} purch=${String(day(l.purchaseDate) ?? "(none)").padEnd(12)} inv=${String(day(l.invoicedDate) ?? "(none)").padEnd(12)} total=${usd(l.totalPrice).padStart(13)} actual=${usd(l.actualAmount).padStart(13)}`,
      );
    }
  }
  console.log();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
