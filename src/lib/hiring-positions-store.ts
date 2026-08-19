import "server-only";
import { prisma } from "@/lib/prisma";

// The durable half of "Hiring Position -> Workforce Group -> Department"
// (2026-08-19) — raw-SQL accessed, same reason as RolePermission/
// BuildReadinessSavedView: `prisma generate` is blocked on this box while a
// server process holds node_modules/.prisma open, so HiringPositionAssignment
// has no generated Client model to call. See the model's own comment in
// schema.prisma for why a row existing at all (however null its two columns)
// means "explicitly cleared", not "never touched".

export type HiringAssignmentRow = {
  positionSourceId: string;
  workforceGroup: string | null;
  department: string | null;
  expectedStartDate: Date | null;
  updatedByEmail: string | null;
  updatedAt: Date;
};

export async function getHiringAssignments(): Promise<HiringAssignmentRow[]> {
  return prisma.$queryRaw<HiringAssignmentRow[]>`
    SELECT positionSourceId, workforceGroup, department, expectedStartDate, updatedByEmail, updatedAt
      FROM HiringPositionAssignment
  `;
}

export async function getHiringAssignment(positionSourceId: string): Promise<HiringAssignmentRow | null> {
  const rows = await prisma.$queryRaw<HiringAssignmentRow[]>`
    SELECT positionSourceId, workforceGroup, department, expectedStartDate, updatedByEmail, updatedAt
      FROM HiringPositionAssignment
     WHERE positionSourceId = ${positionSourceId}
     LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function setHiringAssignment(
  positionSourceId: string,
  workforceGroup: string | null,
  department: string | null,
  actorEmail: string | null,
): Promise<void> {
  // Lists only workforceGroup/department in the UPDATE clause -- MySQL leaves
  // any unlisted column (expectedStartDate) untouched on the update branch,
  // so this can never clobber a date set via setHiringExpectedStartDate
  // below, and vice versa.
  await prisma.$executeRaw`
    INSERT INTO HiringPositionAssignment (positionSourceId, workforceGroup, department, updatedByEmail, updatedAt, createdAt)
    VALUES (${positionSourceId}, ${workforceGroup}, ${department}, ${actorEmail}, NOW(3), NOW(3))
    ON DUPLICATE KEY UPDATE workforceGroup = ${workforceGroup}, department = ${department}, updatedByEmail = ${actorEmail}, updatedAt = NOW(3)
  `;
}

/**
 * Sets/clears just the expected-start-date overlay for a workbook-sourced
 * position -- independent of setHiringAssignment above (see its own
 * comment). `expectedStartDate: null` explicitly clears it back to "unknown"
 * (counts as full-year, per workforce-capacity.ts's isStartedByMonth).
 */
export async function setHiringExpectedStartDate(positionSourceId: string, expectedStartDate: Date | null, actorEmail: string | null): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO HiringPositionAssignment (positionSourceId, expectedStartDate, updatedByEmail, updatedAt, createdAt)
    VALUES (${positionSourceId}, ${expectedStartDate}, ${actorEmail}, NOW(3), NOW(3))
    ON DUPLICATE KEY UPDATE expectedStartDate = ${expectedStartDate}, updatedByEmail = ${actorEmail}, updatedAt = NOW(3)
  `;
}

// ── Positions created directly in SDC Reports (2026-08-19) ─────────────────
//
// A position's own authoritative row (see the model's comment in
// schema.prisma for why this is NOT an overlay like HiringPositionAssignment
// above) — title/status/group/department all live here and are edited in
// place.

export type CreatedHiringPositionRow = {
  id: number;
  title: string;
  jobStatus: string;
  workforceGroup: string;
  department: string;
  workLocDescription: string | null;
  remote: boolean;
  internal: boolean;
  expectedStartDate: Date | null;
  createdByEmail: string | null;
  updatedByEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function getCreatedHiringPositions(): Promise<CreatedHiringPositionRow[]> {
  return prisma.$queryRaw<CreatedHiringPositionRow[]>`
    SELECT id, title, jobStatus, workforceGroup, department, workLocDescription, remote, internal, expectedStartDate, createdByEmail, updatedByEmail, createdAt, updatedAt
      FROM HiringPositionCreated
     ORDER BY createdAt DESC
  `;
}

export async function getCreatedHiringPositionById(id: number): Promise<CreatedHiringPositionRow | null> {
  const rows = await prisma.$queryRaw<CreatedHiringPositionRow[]>`
    SELECT id, title, jobStatus, workforceGroup, department, workLocDescription, remote, internal, expectedStartDate, createdByEmail, updatedByEmail, createdAt, updatedAt
      FROM HiringPositionCreated
     WHERE id = ${id}
     LIMIT 1
  `;
  return rows[0] ?? null;
}

export type CreateHiringPositionFields = {
  title: string;
  jobStatus: string;
  workforceGroup: string;
  department: string;
  workLocDescription: string | null;
  remote: boolean;
  internal: boolean;
  expectedStartDate: Date | null;
  actorEmail: string | null;
};

/**
 * Insert + read-back in one transaction — LAST_INSERT_ID() is session-scoped
 * in MySQL, so the insert and the read-back must share the same connection
 * rather than each grabbing whatever connection Prisma's pool hands out next.
 */
export async function insertCreatedHiringPosition(fields: CreateHiringPositionFields): Promise<CreatedHiringPositionRow> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO HiringPositionCreated
        (title, jobStatus, workforceGroup, department, workLocDescription, remote, internal, expectedStartDate, createdByEmail, updatedByEmail, createdAt, updatedAt)
      VALUES
        (${fields.title}, ${fields.jobStatus}, ${fields.workforceGroup}, ${fields.department}, ${fields.workLocDescription}, ${fields.remote}, ${fields.internal}, ${fields.expectedStartDate}, ${fields.actorEmail}, ${fields.actorEmail}, NOW(3), NOW(3))
    `;
    const rows = await tx.$queryRaw<CreatedHiringPositionRow[]>`
      SELECT id, title, jobStatus, workforceGroup, department, workLocDescription, remote, internal, expectedStartDate, createdByEmail, updatedByEmail, createdAt, updatedAt
        FROM HiringPositionCreated
       WHERE id = LAST_INSERT_ID()
    `;
    return rows[0];
  });
}

export type UpdateHiringPositionFields = {
  title: string;
  jobStatus: string;
  workforceGroup: string;
  department: string;
  expectedStartDate: Date | null;
  actorEmail: string | null;
};

export async function updateCreatedHiringPosition(id: number, fields: UpdateHiringPositionFields): Promise<void> {
  await prisma.$executeRaw`
    UPDATE HiringPositionCreated
       SET title = ${fields.title}, jobStatus = ${fields.jobStatus}, workforceGroup = ${fields.workforceGroup},
           department = ${fields.department}, expectedStartDate = ${fields.expectedStartDate}, updatedByEmail = ${fields.actorEmail}, updatedAt = NOW(3)
     WHERE id = ${id}
  `;
}
