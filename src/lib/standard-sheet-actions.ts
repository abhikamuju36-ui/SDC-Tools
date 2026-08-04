"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { assertStandardSheetUnlocked } from "@/lib/standard-sheet-gate";
import { round2 } from "@/lib/etc";
import { CELL_SPECS, parseCell, type FieldSpec } from "@/lib/cell-rules";
import { poolRefreshBlockedBy } from "@/lib/standard-pool-eligibility";

// The Standard Sheet workflow — pool refresh/editing, the month freeze, and
// per-job Contingency/Notes editing — used to live only on the /standard-sheet
// tab. It now runs from the Monthly ETC page's unlocked Standard view; that tab
// is retired. The one behavioral change from the old tab: the month freeze
// stamps every job with the single GLOBAL execution rate set (StandardSheetSetting),
// matching what /etc displays, instead of per-job ExecutionRate rows.

// The department pools for `month`, or — if that month was never refreshed —
// the most recent PRIOR month's pools as a labeled fallback (so Standard Fees
// never silently collapse to $0). `carriedFrom` is the source month when the
// fallback kicked in, else null.
export async function loadEffectivePools(month: string) {
  const own = await prisma.categoryPool.findMany({ where: { month } });
  if (own.length > 0) return { pools: own, carriedFrom: null as string | null };
  const prior = await prisma.categoryPool.findFirst({
    where: { month: { lt: month } },
    orderBy: { month: "desc" },
    select: { month: true },
  });
  if (!prior) return { pools: own, carriedFrom: null as string | null };
  return { pools: await prisma.categoryPool.findMany({ where: { month: prior.month } }), carriedFrom: prior.month };
}

// A submitted month is frozen — server actions must enforce it, not just the
// UI hiding buttons. Also the single choke point every month-scoped action
// passes through, so a crafted/garbage month can never reach a write.
//
// Also refuses a month whose pools came from the PBI historical backfill
// (source: "power_bi_history") even without a StandardSheetSnapshot: editing
// those would corrupt the verified ledger chain (sync-powerbi.ts carries
// `prior.newEtcHours` forward), and a later refresh of the FOLLOWING month
// would then inherit the tampered balance — the same class of bug the June
// 2026 pool-reset investigation found and fixed.
// The rule itself lives in standard-pool-eligibility.ts, because the 6-hour pass
// applies the SAME rule (as a skip rather than an error) and a ledger rule that
// exists in two places is a ledger rule that will eventually disagree with
// itself. This function only turns a block into the message a human needs.
async function assertMonthNotSubmitted(month: string) {
  const blocked = await poolRefreshBlockedBy(month);
  if (blocked === "submitted") throw new Error(`${month} is submitted and frozen — reopen it first.`);
  if (blocked === "historical") {
    throw new Error(
      `${month}'s pools came from Power BI's historical archive — editing them here would break the balance chain to later months.`,
    );
  }
}


// ── `refreshPools` is GONE (§26.11, 2026-08-04) ─────────────────────────────
//
// It recomputed this month's four category-pool rows and nothing else, behind a
// "Refresh" button in the Standard Fees card's header. That is precisely the
// partial refresh §25 was written to end: `standard_pools` is one of the sources
// the application-wide "Refresh Data" pass covers (auto-sync.ts, which calls the
// same computeCategoryPoolsLocally with the same poolRefreshBlockedBy rule), so
// the button's only remaining effect was to refresh four figures on a different
// clock from every figure beside them — and to give the pools a second way to
// move that the refresh log did not record.
//
// Nothing is lost. "Refresh Data" recomputes the pools for the working month, and
// the hourly schedule does it unattended. What WAS unique to this action —
// assertMonthNotSubmitted, the frozen/archived ledger guard — is not lost either:
// it lives in standard-pool-eligibility.ts and both remaining callers apply it.

// Saves the two manual cells of each "Standard Fees By Department" block —
// Hours being pulled this month and Rate — and recomputes the derived cells:
// New ETC Hours = Hours Available − Hours Pulled, Standard Fee = New ETC × Rate.
export async function savePools(month: string, formData: FormData) {
  await assertStandardSheetUnlocked();
  await assertMonthNotSubmitted(month);
  const categories = ["ENGINEERING_PM", "ENGINEERING_WARRANTY", "SHOP_MANUFACTURING", "SHOP_WARRANTY"] as const;
  const changes: Record<string, unknown>[] = [];

  // One parser, from lib/cell-rules.ts (§27.15). What this replaces is a local
  // `Number.isFinite(n) || n < 0` that was the fourth different spelling of the same
  // check in the codebase — and the only one that refused a pasted "1,234".
  //
  // The "absent AND cleared both keep the stored value" rule is preserved exactly: a
  // field wiped mid-edit must not silently save 0, because a 0 Rate collapses that
  // whole department's Standard Fee to $0. An explicit zero is still saveable.
  const manualCell = (name: string, spec: FieldSpec, stored: number): number => {
    const intent = parseCell(formData.get(name), spec);
    if (intent.kind === "absent" || intent.kind === "clear") return stored;
    if (intent.kind === "invalid") throw new Error(intent.message);
    return intent.value as number;
  };

  const writes: { id: number; data: Record<string, number> }[] = [];
  for (const category of categories) {
    const pool = await prisma.categoryPool.findUnique({ where: { category_month: { category, month } } });
    if (!pool) continue; // pool rows come from Refresh Pools (Power BI) or migration
    // Hours pulled is stored as a whole number (2026-08-02, by request) — it's
    // a manual decision and the panel displays it, and every figure derived
    // from it, rounded anyway. Rounding on the way in keeps the stored value,
    // the cell on screen and the Standard Fee it drives all telling the same
    // story. Applied to the fallback too, so a save that doesn't touch this
    // field still normalises a legacy decimal. Rate is NOT rounded — that one
    // legitimately carries cents.
    // The spec already rounds to whole (pool.hoursPulled has decimals: 0), so the
    // Math.round that used to sit here is gone: one rounding, in one place (§27.18).
    // The fallback is rounded too, so a save that doesn't touch this field still
    // normalises a legacy decimal — which is what the old Math.round also did.
    const hoursPulledThisMonth = manualCell(
      `pulled__${category}`,
      CELL_SPECS["pool.hoursPulled"],
      Math.round(Number(pool.hoursPulledThisMonth)),
    );
    const rate = manualCell(`rate__${category}`, CELL_SPECS["pool.rate"], Number(pool.rate));
    const newEtcHours = round2(Number(pool.hoursAvailable) - hoursPulledThisMonth);
    const standardFee = round2(newEtcHours * rate);
    writes.push({ id: pool.id, data: { hoursPulledThisMonth, rate, newEtcHours, standardFee } });
    changes.push({ category, hoursPulledThisMonth, rate, newEtcHours, standardFee });
  }
  await prisma.$transaction(writes.map((w) => prisma.categoryPool.update({ where: { id: w.id }, data: w.data })));

  await logAudit({
    action: "standardSheet.savePools",
    entityType: "CategoryPool",
    entityId: month,
    summary: `Saved category pool cells for ${month}`,
    metadata: { changes },
  });
  revalidatePath("/etc");
}

// Per-job Contingency $ and Notes — the sheet's manual R/Notes columns. Edited
// inline in the /etc Standard block now that the tab is gone. Split into two
// single-field saves so editing one never clobbers the other's stored value.
export async function saveContingencyAmount(jobId: number, contingencyAmount: number) {
  await assertStandardSheetUnlocked();
  if (!Number.isInteger(jobId)) throw new Error(`Invalid job id "${jobId}".`);
  // §27.15 — the same spec the cell validates against, re-checked here, because a
  // server action is an HTTP endpoint and "the input had min=0" is not a check.
  const amount = parseCell(contingencyAmount, CELL_SPECS["standard.contingencyAmount"]);
  if (amount.kind === "invalid") throw new Error(amount.message);
  if (amount.kind === "absent") throw new Error("Contingency is required.");
  const contingency = amount.kind === "clear" ? 0 : (amount.value as number);
  await prisma.executionRate.upsert({
    where: { jobId },
    update: { contingencyAmount: contingency },
    create: { jobId, contingencyAmount: contingency },
  });
  await logAudit({ action: "standardSheet.saveContingency", entityType: "ExecutionRate", entityId: String(jobId), summary: `Saved contingency ${contingencyAmount} for job ${jobId}` });
  revalidatePath("/etc");
}

export async function saveJobNotes(jobId: number, notes: string) {
  await assertStandardSheetUnlocked();
  if (!Number.isInteger(jobId)) throw new Error(`Invalid job id "${jobId}".`);
  await prisma.executionRate.upsert({
    where: { jobId },
    update: { notes },
    create: { jobId, notes },
  });
  await logAudit({ action: "standardSheet.saveNotes", entityType: "ExecutionRate", entityId: String(jobId), summary: `Saved notes for job ${jobId}` });
  revalidatePath("/etc");
}

// The global contingency multiplier (StandardSheetSetting.contingencyRate).
export async function saveContingencyRate(contingencyRate: number) {
  await assertStandardSheetUnlocked();
  const rate = parseCell(contingencyRate, CELL_SPECS["standard.contingencyRate"]);
  if (rate.kind !== "value") throw new Error(rate.kind === "invalid" ? rate.message : "Contingency Rate is required.");
  contingencyRate = rate.value as number;
  const before = await prisma.standardSheetSetting.findUnique({ where: { id: 1 } });
  await prisma.standardSheetSetting.upsert({
    where: { id: 1 },
    update: { contingencyRate },
    create: { id: 1, contingencyRate },
  });
  await logAudit({
    action: "standardSheet.saveContingencyRate",
    entityType: "StandardSheetSetting",
    summary: `Changed global contingency rate to ${contingencyRate}`,
    metadata: { before: before ? Number(before.contingencyRate) : null, after: contingencyRate },
  });
  revalidatePath("/etc");
}

// ── Submitting and reopening moved out of this file (§15/§16, 2026-08-04) ────
//
// `submitStandardSheetMonth` and `reopenStandardSheetMonth` are gone. They were the
// second half of a two-button month: this file froze StandardSheetSnapshot while
// etc-actions.ts froze EtcEntry, independently, so the normal state of a month was
// HALF-submitted — the ETC figures locked while the fees derived from them were still
// live and moving. July 2026 was exactly that when somebody asked why the same button
// existed twice.
//
// Both tables are now written by ONE action inside ONE transaction:
// lib/monthly-report-actions.ts (submitMonthlyReport / reopenMonthlyReport), with the
// fee-row computation in lib/monthly-report.ts (loadStandardSheetRows) so the live
// Standard view and the frozen snapshot still come from the same arithmetic.
//
// What stays in this file is what belongs to the POOLS themselves: Refresh Pools, the
// two manual pool cells, and the per-job Contingency/Notes.
