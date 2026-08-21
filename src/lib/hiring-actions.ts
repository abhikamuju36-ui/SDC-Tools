"use server";

import { assertActionPermission } from "@/lib/require-permission";
import {
  setHiringAssignment,
  setHiringExpectedStartDate,
  setHiringPositionVisibility as setHiringPositionVisibilityRow,
  insertCreatedHiringPosition,
  updateCreatedHiringPosition as updateCreatedHiringPositionRow,
  updateCreatedHiringPositionVisibility,
} from "@/lib/hiring-positions-store";
import { getHiringPositionById } from "@/lib/hiring-positions";
import { logAudit } from "@/lib/audit";
import { EMPLOYEE_TEAMS } from "@/lib/employee-teams";
import { workforceGroupForCardKey, WORKFORCE_GROUPS, type WorkforceGroupKey } from "@/lib/employee-workforce-groups";
import { MANUAL_JOB_STATUSES, DEFAULT_MANUAL_JOB_STATUS, isManualJobStatus } from "@/lib/hiring-position-status";

// The write paths for hiring positions (2026-08-19) — `employees:hiring:assign`
// gates all of them (create/edit/move), same permission key as before this
// feature, just broader scope now. Every call is audited via the existing
// AuditLog (logAudit) — no separate hiring-specific audit table.

const VALID_GROUPS = new Set(WORKFORCE_GROUPS.map((g) => g.key));
const ASSIGNABLE_GROUPS = new Set(WORKFORCE_GROUPS.filter((g) => g.key !== "other").map((g) => g.key));
const VALID_DEPARTMENTS = new Set(EMPLOYEE_TEAMS.map((t) => t.schedulerCode));

export type AssignHiringPositionResult = { ok: true } | { ok: false; error: string };

/**
 * `department` implies its own workforce group (a department belongs to
 * exactly one group — employee-workforce-groups.ts) — the caller only ever
 * needs to pass ONE of {group-only, department}, never both independently,
 * so there is no way to submit a group/department pair that disagree with
 * each other. Passing both `null` explicitly clears the position back to
 * Unassigned (a real write — see the model's own comment on why that differs
 * from never having a row at all).
 *
 * Workbook-sourced positions ONLY — a manually-created position's group/
 * department live directly on its own HiringPositionCreated row (there is no
 * external source to overlay), so it's edited via updateHiringPosition
 * instead. Rejected here rather than silently writing a useless
 * HiringPositionAssignment row a manual position would never consult.
 */
export async function assignHiringPosition(
  positionSourceId: string,
  target: { workforceGroup: WorkforceGroupKey | null; department: string | null },
): Promise<AssignHiringPositionResult> {
  const session = await assertActionPermission("employees:hiring:assign");
  if (!positionSourceId) return { ok: false, error: "Missing position." };
  if (positionSourceId.startsWith("manual-")) return { ok: false, error: "This position was created in SDC Reports — edit it directly instead of moving it." };

  const { department } = target;
  let { workforceGroup } = target;
  if (department) {
    if (!VALID_DEPARTMENTS.has(department)) return { ok: false, error: `"${department}" isn't a known department.` };
    workforceGroup = workforceGroupForCardKey(department); // department is authoritative over whatever group was also passed
  } else if (workforceGroup && !VALID_GROUPS.has(workforceGroup)) {
    return { ok: false, error: `"${workforceGroup}" isn't a known workforce group.` };
  }

  const before = await getHiringPositionById(positionSourceId);
  if (!before) return { ok: false, error: "This position is no longer open — it may have been filled or removed from the workbook." };

  await setHiringAssignment(positionSourceId, workforceGroup, department, session.user.email ?? null);

  await logAudit({
    action: "hiring.positionAssigned",
    entityType: "HiringPositionAssignment",
    entityId: positionSourceId,
    summary: `${before.title}: ${before.workforceGroup ?? "Unassigned"}/${before.department ?? "—"} → ${workforceGroup ?? "Unassigned"}/${department ?? "—"} (by ${session.user.email ?? "unknown"})`,
    metadata: {
      positionSourceId,
      title: before.title,
      previousWorkforceGroup: before.workforceGroup,
      previousDepartment: before.department,
      newWorkforceGroup: workforceGroup,
      newDepartment: department,
    },
  });

  return { ok: true };
}

export type SetHiringExpectedStartDateResult = { ok: true } | { ok: false; error: string };

/**
 * Workbook-sourced positions ONLY, same reason as assignHiringPosition above
 * — a manual position's expected start date lives directly on its own
 * HiringPositionCreated row, edited via updateHiringPosition instead. `date:
 * null` explicitly clears it back to "unknown" (full-year, not zero — see
 * workforce-capacity.ts's isStartedByMonth).
 */
export async function setHiringPositionExpectedStartDate(positionSourceId: string, date: Date | null): Promise<SetHiringExpectedStartDateResult> {
  const session = await assertActionPermission("employees:hiring:assign");
  if (!positionSourceId) return { ok: false, error: "Missing position." };
  if (positionSourceId.startsWith("manual-")) return { ok: false, error: "This position was created in SDC Reports — edit it directly instead." };

  const before = await getHiringPositionById(positionSourceId);
  if (!before) return { ok: false, error: "This position is no longer open — it may have been filled or removed from the workbook." };

  // The position's CURRENT effective group/department (manual or still just
  // the classifier's best-effort guess) -- so if this position has no
  // HiringPositionAssignment row yet, creating one here for the date alone
  // doesn't also blank out its placement. See
  // setHiringExpectedStartDate's own comment.
  await setHiringExpectedStartDate(positionSourceId, date, before.workforceGroup, before.department, session.user.email ?? null);

  await logAudit({
    action: "hiring.expectedStartDateSet",
    entityType: "HiringPositionAssignment",
    entityId: positionSourceId,
    summary: `${before.title}: expected start ${before.expectedStartDate?.toLocaleDateString("en-US") ?? "—"} → ${date?.toLocaleDateString("en-US") ?? "—"} (by ${session.user.email ?? "unknown"})`,
    metadata: {
      positionSourceId,
      title: before.title,
      previousExpectedStartDate: before.expectedStartDate,
      newExpectedStartDate: date,
    },
  });

  return { ok: true };
}

export type SetHiringPositionVisibilityResult = { ok: true } | { ok: false; error: string };

/**
 * Workbook-sourced positions ONLY, same reason as assignHiringPosition/
 * setHiringPositionExpectedStartDate above — a manual position's visibility
 * is set via setCreatedHiringPositionVisibility instead.
 *
 * Display-only: does not touch isOpen/status, so this never affects Open
 * Positions, Planned Headcount, Hiring Capacity Hours, or any workforce-
 * group/department hiring total — see redactHiddenPositions in
 * hiring-positions.ts for how hiding actually takes effect (identity
 * redaction for non-editors, never a change to the position's own data).
 */
export async function setHiringPositionVisibility(positionSourceId: string, isVisible: boolean): Promise<SetHiringPositionVisibilityResult> {
  const session = await assertActionPermission("employees:hiring:assign");
  if (!positionSourceId) return { ok: false, error: "Missing position." };
  if (positionSourceId.startsWith("manual-")) return { ok: false, error: "This position was created in SDC Reports — use its own Hide/Show control instead." };

  const before = await getHiringPositionById(positionSourceId);
  if (!before) return { ok: false, error: "This position is no longer open — it may have been filled or removed from the workbook." };

  // Current effective group/department/date -- so a first-ever
  // HiringPositionAssignment row created here for visibility alone doesn't
  // also blank them. See setHiringPositionVisibility's own comment in
  // hiring-positions-store.ts.
  await setHiringPositionVisibilityRow(positionSourceId, isVisible, before.workforceGroup, before.department, before.expectedStartDate, session.user.email ?? null);

  await logAudit({
    action: "hiring.visibilityChanged",
    entityType: "HiringPositionAssignment",
    entityId: positionSourceId,
    summary: `${before.title}: ${before.isVisible ? "Shown" : "Hidden"} → ${isVisible ? "Shown" : "Hidden"} (by ${session.user.email ?? "unknown"})`,
    metadata: {
      positionSourceId,
      title: before.title,
      previousIsVisible: before.isVisible,
      newIsVisible: isVisible,
    },
  });

  return { ok: true };
}

/** Manually-created positions ONLY — see setHiringPositionVisibility's comment above. */
export async function setCreatedHiringPositionVisibility(sourceId: string, isVisible: boolean): Promise<SetHiringPositionVisibilityResult> {
  const session = await assertActionPermission("employees:hiring:assign");
  const match = /^manual-(\d+)$/.exec(sourceId);
  if (!match) return { ok: false, error: "Only positions created in SDC Reports can be hidden this way." };
  const id = Number(match[1]);

  const before = await getHiringPositionById(sourceId);
  if (!before) return { ok: false, error: "This position no longer exists." };

  await updateCreatedHiringPositionVisibility(id, isVisible, session.user.email ?? null);

  await logAudit({
    action: "hiring.visibilityChanged",
    entityType: "HiringPositionCreated",
    entityId: sourceId,
    summary: `${before.title}: ${before.isVisible ? "Shown" : "Hidden"} → ${isVisible ? "Shown" : "Hidden"} (by ${session.user.email ?? "unknown"})`,
    metadata: {
      sourceId,
      title: before.title,
      previousIsVisible: before.isVisible,
      newIsVisible: isVisible,
    },
  });

  return { ok: true };
}

export type HiringPositionFormInput = {
  title: string;
  jobStatus: string;
  workforceGroup: WorkforceGroupKey;
  department: string;
  workLocDescription?: string | null;
  remote?: boolean;
  internal?: boolean;
  expectedStartDate?: Date | null;
};

export type HiringPositionActionResult = { ok: true; sourceId: string } | { ok: false; error: string };

function validateGroupDepartment(workforceGroup: string, department: string): string | null {
  if (!ASSIGNABLE_GROUPS.has(workforceGroup as WorkforceGroupKey)) return `"${workforceGroup}" isn't a valid workforce group.`;
  if (!VALID_DEPARTMENTS.has(department)) return `"${department}" isn't a known department.`;
  if (workforceGroupForCardKey(department) !== workforceGroup) return `"${department}" doesn't belong to the ${workforceGroup} group.`;
  return null;
}

/** The "+ Create Position" drawer's write path — see HiringPositionCreated's own comment in schema.prisma for why this is a real table, not a write into Job.xlsx. */
export async function createHiringPosition(input: HiringPositionFormInput): Promise<HiringPositionActionResult> {
  const session = await assertActionPermission("employees:hiring:assign");

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Position Title is required." };

  const jobStatus = input.jobStatus.trim() || DEFAULT_MANUAL_JOB_STATUS;
  if (!isManualJobStatus(jobStatus)) return { ok: false, error: `Job Status must be one of: ${MANUAL_JOB_STATUSES.join(", ")}.` };

  const groupDeptError = validateGroupDepartment(input.workforceGroup, input.department);
  if (groupDeptError) return { ok: false, error: groupDeptError };

  const row = await insertCreatedHiringPosition({
    title,
    jobStatus,
    workforceGroup: input.workforceGroup,
    department: input.department,
    workLocDescription: input.workLocDescription?.trim() || null,
    remote: !!input.remote,
    internal: !!input.internal,
    expectedStartDate: input.expectedStartDate ?? null,
    actorEmail: session.user.email ?? null,
  });

  const sourceId = `manual-${row.id}`;

  await logAudit({
    action: "hiring.positionCreated",
    entityType: "HiringPositionCreated",
    entityId: sourceId,
    summary: `${title}: created as ${jobStatus} · ${input.workforceGroup} · ${input.department} (by ${session.user.email ?? "unknown"})`,
    metadata: { sourceId, title, jobStatus, workforceGroup: input.workforceGroup, department: input.department },
  });

  return { ok: true, sourceId };
}

/** Editing a manually-created position — title/status/group/department all live directly on its row (see createHiringPosition's comment). Workbook-sourced positions aren't editable this way; use assignHiringPosition for their group/department. */
export async function updateHiringPosition(sourceId: string, input: HiringPositionFormInput): Promise<HiringPositionActionResult> {
  const session = await assertActionPermission("employees:hiring:assign");
  const match = /^manual-(\d+)$/.exec(sourceId);
  if (!match) return { ok: false, error: "Only positions created in SDC Reports can be edited this way." };
  const id = Number(match[1]);

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Position Title is required." };

  const jobStatus = input.jobStatus.trim();
  if (!isManualJobStatus(jobStatus)) return { ok: false, error: `Job Status must be one of: ${MANUAL_JOB_STATUSES.join(", ")}.` };

  const groupDeptError = validateGroupDepartment(input.workforceGroup, input.department);
  if (groupDeptError) return { ok: false, error: groupDeptError };

  const before = await getHiringPositionById(sourceId);
  if (!before) return { ok: false, error: "This position no longer exists." };

  await updateCreatedHiringPositionRow(id, {
    title,
    jobStatus,
    workforceGroup: input.workforceGroup,
    department: input.department,
    expectedStartDate: input.expectedStartDate ?? null,
    actorEmail: session.user.email ?? null,
  });

  await logAudit({
    action: "hiring.positionUpdated",
    entityType: "HiringPositionCreated",
    entityId: sourceId,
    summary: `${before.title}: ${before.status} · ${before.workforceGroup ?? "—"}/${before.department ?? "—"} → ${jobStatus} · ${input.workforceGroup}/${input.department} (by ${session.user.email ?? "unknown"})`,
    metadata: {
      sourceId,
      previousTitle: before.title,
      previousJobStatus: before.status,
      previousWorkforceGroup: before.workforceGroup,
      previousDepartment: before.department,
      newTitle: title,
      newJobStatus: jobStatus,
      newWorkforceGroup: input.workforceGroup,
      newDepartment: input.department,
    },
  });

  return { ok: true, sourceId };
}
