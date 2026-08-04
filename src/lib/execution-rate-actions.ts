"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { assertStandardSheetUnlocked } from "@/lib/standard-sheet-gate";
import { CELL_SPECS, parseCell } from "@/lib/cell-rules";

// Global execution rates for the Monthly ETC grid's inline Standard Sheet view.
// Entered once via the "ETC Rates" button and applied to every job on that page
// (the per-job rate columns there were removed). Stored on the singleton
// StandardSheetSetting row — distinct from the /standard-sheet tab's per-job
// ExecutionRate rows, which this does not touch.
export async function saveStandardRates(engrRate: number, shopRate: number, partsMarkup: number, contingencyRate: number) {
  await assertStandardSheetUnlocked();
  // §27.15 — one definition per cell, checked here as well as in the browser. This
  // replaces a loop that applied ONE rule to four fields that do not share one: a 0
  // Engineering Rate collapses every fee on the sheet to $0 and must be refused,
  // while a 0 Contingency Rate is ordinary. The registry says so per field.
  const checked = { engrRate, shopRate, partsMarkup, contingencyRate };
  for (const [name, spec] of [
    ["engrRate", CELL_SPECS["standard.engrRate"]],
    ["shopRate", CELL_SPECS["standard.shopRate"]],
    ["partsMarkup", CELL_SPECS["standard.partsMarkup"]],
    ["contingencyRate", CELL_SPECS["standard.contingencyRate"]],
  ] as const) {
    const out = parseCell(checked[name], spec);
    if (out.kind !== "value") throw new Error(out.kind === "invalid" ? out.message : `${spec.label} is required.`);
    checked[name] = out.value as number;
  }
  ({ engrRate, shopRate, partsMarkup, contingencyRate } = checked);

  await prisma.standardSheetSetting.upsert({
    where: { id: 1 },
    update: { engrRate, shopRate, partsMarkup, contingencyRate },
    create: { id: 1, engrRate, shopRate, partsMarkup, contingencyRate },
  });

  await logAudit({
    action: "standardRates.save",
    entityType: "StandardSheetSetting",
    entityId: "1",
    summary: `Set global ETC rates: ENGR ${engrRate}, Shop ${shopRate}, Parts ${partsMarkup}, Contingency ${contingencyRate}`,
  });

  revalidatePath("/etc");
}
