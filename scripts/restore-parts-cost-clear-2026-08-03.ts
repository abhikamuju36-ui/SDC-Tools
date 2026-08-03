// One-off repair: put back the 39 Parts Cost New ETC values that the 2026-08-03
// Clear ETC run emptied.
//
// Clear ETC was scoped to "yellow" cells, and at the time Parts Cost had been brought
// onto the same reopened-untouched rule as the section-hours columns — so a reopened
// month's carried-over dollar estimates counted as unanswered and were blanked. That
// is not what that column is for: Parts Cost New ETC must always show a figure
// (confirmed by the user 2026-08-03). The code now excludes it via
// NewEtcCellState.reopenAsksAgain, and this restores the data.
//
// Every removed value is in the clear's own audit metadata, so this is an exact
// reversal rather than a recomputation: newEtcDraft goes back to what it was and the
// "deliberately blank" marker is dropped, which lets the cell seed from its confirmed
// value again exactly as it did before.
//
// Idempotent: rows that are no longer blank are skipped, so re-running is safe.
import { prisma } from "../src/lib/prisma";
import { PARTS_COST_SECTION } from "../src/lib/sections";

type ClearedRow = { entryId: number; jobId: number; section: string; draft: number | null; confirmed: number | null };

const APPLY = process.argv.includes("--apply");

async function main() {
  const audit = await prisma.auditLog.findFirst({
    where: { action: { contains: "clearYellowNewEtc" } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, entityId: true, metadata: true },
  });
  if (!audit?.metadata) throw new Error("No clearYellowNewEtc audit row found — nothing to restore from.");

  const cleared = (audit.metadata as { cleared?: ClearedRow[] }).cleared ?? [];
  const parts = cleared.filter((c) => c.section === PARTS_COST_SECTION);
  console.log(`Clear ran ${audit.createdAt.toISOString()} for ${audit.entityId}: ${cleared.length} cells, ${parts.length} of them Parts Cost.`);

  // Only touch cells that are still blank-because-cleared. Anything a manager has
  // typed since must not be overwritten by a value from before the clear.
  const current = await prisma.etcEntry.findMany({
    where: { id: { in: parts.map((p) => p.entryId) } },
    select: { id: true, jobId: true, newEtcDraft: true, newEtc: true, newEtcClearedAt: true, needsReview: true },
  });
  const byId = new Map(current.map((c) => [c.id, c]));

  const toRestore: { id: number; jobId: number; draft: number | null; shows: number }[] = [];
  let skippedTouched = 0;
  let skippedMissing = 0;
  for (const p of parts) {
    const row = byId.get(p.entryId);
    if (!row) { skippedMissing++; continue; }
    if (row.newEtcClearedAt == null || row.newEtcDraft != null) { skippedTouched++; continue; }
    toRestore.push({
      id: p.entryId,
      jobId: p.jobId,
      draft: p.draft,
      // What the box will show once restored: its draft if it had one, else the
      // confirmed value it seeds from.
      shows: p.draft ?? p.confirmed ?? Number(row.newEtc),
    });
  }

  console.log(`\nto restore: ${toRestore.length}   already touched/not blank: ${skippedTouched}   missing: ${skippedMissing}`);
  for (const r of toRestore.slice(0, 10)) console.log(`  job=${r.jobId} draft=${r.draft} -> cell will show ${r.shows}`);
  if (toRestore.length > 10) console.log(`  … and ${toRestore.length - 10} more`);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to restore.");
    await prisma.$disconnect();
    return;
  }

  // Two groups: rows whose draft was null (drop the marker and let them seed from
  // the confirmed value) and rows that carried a real draft (put it back).
  const nullDraft = toRestore.filter((r) => r.draft == null).map((r) => r.id);
  const withDraft = toRestore.filter((r) => r.draft != null);

  if (nullDraft.length > 0) {
    await prisma.etcEntry.updateMany({ where: { id: { in: nullDraft } }, data: { newEtcClearedAt: null } });
  }
  for (const r of withDraft) {
    await prisma.etcEntry.update({ where: { id: r.id }, data: { newEtcDraft: r.draft, newEtcClearedAt: null } });
  }

  console.log(`\nRestored ${toRestore.length} Parts Cost cells (${nullDraft.length} seeded from confirmed, ${withDraft.length} with a draft put back).`);
  await prisma.$disconnect();
}

main();
