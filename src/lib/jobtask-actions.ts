"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { CELL_SPECS, parseCell } from "@/lib/cell-rules";

// Task assignments mirror the sheet's "ME Name" columns (slots 1-11).

export async function saveJobTask(jobId: number, slot: number | null, formData: FormData) {
  if (!Number.isInteger(jobId) || jobId <= 0) throw new Error(`Invalid job id "${jobId}".`);
  const taskName = String(formData.get("taskName") ?? "").trim();
  if (!taskName) throw new Error("Task name is required.");

  // §27.15 — the shared parser, so a pasted "1,200" works here exactly as it does in
  // every other hours cell. Blank still means 0, which is this column's documented rule.
  const parsedHours = parseCell(formData.get("hours"), CELL_SPECS["jobtask.hours"]);
  if (parsedHours.kind === "invalid") throw new Error(parsedHours.message);
  const hours = parsedHours.kind === "value" ? (parsedHours.value as number) : 0;

  if (slot === null) {
    // New task: next free slot (the sheet had 11 columns; the app doesn't cap).
    // Use create (not upsert): if two "Add Task" clicks race and both compute
    // the same next slot, the second hits the jobId_slot unique constraint and
    // fails loudly instead of silently OVERWRITING the first task's row.
    const last = await prisma.jobTask.findFirst({ where: { jobId }, orderBy: { slot: "desc" }, select: { slot: true } });
    slot = (last?.slot ?? 0) + 1;
    await prisma.jobTask.create({ data: { jobId, slot, taskName, estimateToCompleteHours: hours } });
  } else {
    await prisma.jobTask.upsert({
      where: { jobId_slot: { jobId, slot } },
      update: { taskName, estimateToCompleteHours: hours },
      create: { jobId, slot, taskName, estimateToCompleteHours: hours },
    });
  }
  await logAudit({
    action: "jobtask.save",
    entityType: "JobTask",
    entityId: `${jobId}-${slot}`,
    summary: `Saved task "${taskName}" (${hours}h) on job ${jobId}, slot ${slot}`,
    metadata: { jobId, slot, taskName, hours },
  });
  revalidatePath(`/jobs/${jobId}`);
}

export async function deleteJobTask(id: number, _formData: FormData) {
  const task = await prisma.jobTask.delete({ where: { id } });
  await logAudit({
    action: "jobtask.delete",
    entityType: "JobTask",
    entityId: id,
    summary: `Deleted task "${task.taskName}" from job ${task.jobId}`,
  });
  revalidatePath(`/jobs/${task.jobId}`);
}
