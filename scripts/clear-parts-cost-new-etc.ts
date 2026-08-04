// Applies Clear ETC to the PARTS COST column of one month, and nothing else.
//
// Why it exists (2026-08-04): Parts Cost New ETC stopped auto-filling when money
// was spent — the cells go yellow and the manager enters the figure, exactly like
// the hours cells. That is a rule about what the page RENDERS, and July 2026 was
// already carrying values that the old rule had put in the boxes: 47 drafts,
// seeded from last submission, none of them typed by anyone. Under the new rule
// those cells are yellow-and-pre-filled, which is the one state the request was
// about ("do not automatically fill... highlight in yellow instead").
//
// This is the toolbar's Clear ETC, scoped to one column. Same rule
// (isNewEtcClearable), same two fields written, same audit trail — so the values
// removed can be read back out of the log. Scoped rather than just clicking the
// button because the button would also sweep the hours cells, and those hold
// today's in-progress work.
//
// What it will NOT touch, by construction:
//   • a figure somebody actually typed (a draft that differs from the confirmed
//     value reads as decided)
//   • a cell with NO money spent — the balance carries forward there and no
//     question is being asked
//   • confirmed history (`needsReview` false), or any row in a locked month
//
//   dry run:  npx tsx scripts/clear-parts-cost-new-etc.ts 2026-07
//   for real: npx tsx scripts/clear-parts-cost-new-etc.ts 2026-07 --write
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { isNewEtcClearable, isMonthLocked, newEtcSeedText, round2, type NewEtcCellState } from "../src/lib/etc";
import { PARTS_COST_SECTION } from "../src/lib/sections";
import { logAudit } from "../src/lib/audit";

const money = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

async function main() {
  const month = process.argv[2];
  const write = process.argv.includes("--write");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) throw new Error("Pass a month, e.g. 2026-07");
  console.log(`${write ? "WRITING" : "DRY RUN"} — Parts Cost New ETC, ${month}\n`);

  // Locked/historical checks read the WHOLE month, like clearYellowNewEtc does —
  // a column is not its own month.
  const monthEntries = await prisma.etcEntry.findMany({ where: { month }, select: { needsReview: true } });
  if (monthEntries.length === 0) throw new Error(`${month} has no entries.`);
  if (isMonthLocked(monthEntries)) throw new Error(`${month} is submitted and locked — reopen it first.`);
  const latest = await prisma.etcEntry.findFirst({ orderBy: { month: "desc" }, select: { month: true } });
  const isHistorical = latest != null && month < latest.month;

  const parts = await prisma.etcEntry.findMany({
    where: { month, section: PARTS_COST_SECTION, needsReview: true },
    include: { job: { select: { jobId: true, jobName: true } } },
    orderBy: { jobId: "asc" },
  });

  const targets: { id: number; jobId: string; had: string; draft: number | null; confirmed: number | null }[] = [];
  let keptNoSpend = 0;
  let keptDecided = 0;
  let keptAlreadyBlank = 0;
  for (const e of parts) {
    const state: NewEtcCellState = {
      priorEtc: Number(e.priorEtc),
      hoursWorked: round2(Number(e.hoursWorked)),
      draft: e.newEtcDraft != null ? Number(e.newEtcDraft) : null,
      confirmed: isHistorical || e.submittedAt != null ? round2(Number(e.newEtc)) : null,
      cleared: e.newEtcClearedAt != null,
      locked: false, // refused above
      // Only gates the zero-hours carry-forward seed, and a zero-spend cell is
      // decided by definition — so it cannot change any verdict here.
      monthComplete: true,
      precision: "exact",
    };
    if (!isNewEtcClearable(state)) {
      // Three distinct reasons, and telling them apart matters on a REPEAT run:
      // an already-blank yellow cell is the goal state, not a decision.
      if (round2(Number(e.hoursWorked)) === 0) keptNoSpend++;
      else if (newEtcSeedText(state).trim() === "") keptAlreadyBlank++;
      else keptDecided++;
      continue;
    }
    targets.push({
      id: e.id,
      jobId: e.job.jobId,
      had: newEtcSeedText(state),
      draft: state.draft,
      confirmed: state.confirmed,
    });
  }

  for (const t of targets) {
    console.log(`  ${t.jobId.padEnd(6)} clearing ${money(Number(t.had)).padStart(11)}  (draft=${t.draft}, confirmed=${t.confirmed})`);
  }
  console.log(`\n  ${targets.length} cell(s) to clear`);
  console.log(`  ${keptNoSpend} left alone — no money spent, the balance carries forward`);
  console.log(`  ${keptAlreadyBlank} left alone — already blank and yellow, awaiting a figure`);
  console.log(`  ${keptDecided} left alone — a figure somebody decided\n`);

  if (!write) {
    console.log("Nothing written. Re-run with --write to apply.");
    await prisma.$disconnect();
    return;
  }
  if (targets.length === 0) {
    console.log("Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  // Same two fields as clearYellowNewEtc. newEtcClearedAt is what makes the clear
  // STICK: a reopened cell re-seeds from `newEtc` whenever the draft is null, so
  // nulling the draft alone would hand the figure straight back.
  await prisma.etcEntry.updateMany({
    where: { id: { in: targets.map((t) => t.id) } },
    data: { newEtcDraft: null, newEtcClearedAt: new Date() },
  });

  await logAudit({
    action: "etc.clearYellowNewEtc",
    entityType: "EtcEntry",
    entityId: month,
    summary: `Cleared ${targets.length} unconfirmed Parts Cost New ETC value(s) for ${month} (column-scoped, scripts/clear-parts-cost-new-etc.ts)`,
    metadata: { section: PARTS_COST_SECTION, cleared: targets },
  });

  console.log(`Cleared ${targets.length} cell(s). The removed figures are in the audit log.`);
  await prisma.$disconnect();
}

main();
