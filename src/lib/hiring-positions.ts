import "server-only";
import { readHiringWorkbook, isOpenPosition, type HiringPositionSourceRow } from "@/lib/hiring-workbook";
import { classifyHiringPosition } from "@/lib/hiring-position-classify";
import { getHiringAssignments, getCreatedHiringPositions, type HiringAssignmentRow, type CreatedHiringPositionRow } from "@/lib/hiring-positions-store";
import { isOpenHiringStatus } from "@/lib/hiring-position-status";
import type { WorkforceGroupKey } from "@/lib/employee-workforce-groups";

// The one place the Excel source, the manual-assignment table, the
// best-effort classifier, and app-created positions all come together into
// what the Employees tab actually renders (2026-08-19). Nothing downstream of
// this file should ever read hiring-workbook.ts, hiring-position-classify.ts,
// or hiring-positions-store.ts directly — reconciliation (a manual
// assignment always wins over the classifier's guess; a workbook position
// gone from the file simply stops appearing; nothing here ever writes an
// Employee row) all happens exactly once, here.
//
// (2026-08-19, Job Status): positions are no longer filtered down to "open
// only" before being returned — a Filled/Cancelled position stays visible
// (with `isOpen: false`) so it can still be found/filtered historically, per
// the task's own "closed/filled positions should remain available
// historically". Callers that feed hiring/planned-headcount totals must
// filter on `isOpen` themselves (see WorkforceSummaryCards' caller in
// EmployeesGrid.tsx) — this file no longer does that filtering for them.

export type HiringPosition = {
  sourceId: string;
  title: string;
  status: string;
  subStatus: string | null;
  /** Whether this position currently counts toward hiring/planned-headcount totals — see hiring-position-status.ts. */
  isOpen: boolean;
  /** "workbook" = read from Job.xlsx (Paylocity); "manual" = created inside SDC Reports (HiringPositionCreated). */
  source: "workbook" | "manual";
  workforceGroup: WorkforceGroupKey | null;
  /** A DepartmentCard key (an employee-teams.ts schedulerCode) — the SAME key EmployeesCards' own cards use, so a hiring count slots into the identical card as its real employees. */
  department: string | null;
  /** True if a person has explicitly assigned/moved this position — false means workforceGroup/department (if any) are only the classifier's best-effort guess. Always true for a manually-created position (it was assigned outright at creation). */
  isManuallyAssigned: boolean;
  /** Prorates this position's Hiring Capacity hours (workforce-capacity.ts) — null means "unknown," which counts as full-year, not zero. */
  expectedStartDate: Date | null;
  functionDescription: string | null;
  sectionDescription: string | null;
  workLocDescription: string | null;
  createdDate: string | null;
  createdBy: string | null;
  modifiedBy: string | null;
  remote: boolean;
  internal: boolean;
};

export type HiringPositionsResult = {
  positions: HiringPosition[];
  /** Set only when the workbook itself couldn't be read/parsed — the page shows this instead of a card, the same fail-soft pattern tm/page.tsx uses for its own two independent sources. Manually-created positions still show even when this is set — they don't depend on the workbook being readable. */
  error: string | null;
};

function toWorkbookPosition(row: HiringPositionSourceRow, manual: HiringAssignmentRow | undefined): HiringPosition {
  const auto = classifyHiringPosition(row);
  const workforceGroup = manual ? (manual.workforceGroup as WorkforceGroupKey | null) : auto.workforceGroup;
  const department = manual ? manual.department : auto.department;
  return {
    sourceId: row.sourceId,
    title: row.title,
    status: row.status,
    subStatus: row.subStatus,
    isOpen: isOpenPosition(row),
    source: "workbook",
    workforceGroup,
    department,
    isManuallyAssigned: !!manual,
    expectedStartDate: manual?.expectedStartDate ?? null,
    functionDescription: row.functionDescription,
    sectionDescription: row.sectionDescription,
    workLocDescription: row.workLocDescription,
    createdDate: row.createdDate,
    createdBy: row.createdBy,
    modifiedBy: row.modifiedBy,
    remote: row.remote,
    internal: row.internal,
  };
}

function toManualPosition(row: CreatedHiringPositionRow): HiringPosition {
  return {
    sourceId: `manual-${row.id}`,
    title: row.title,
    status: row.jobStatus,
    subStatus: null,
    isOpen: isOpenHiringStatus(row.jobStatus, null, false),
    source: "manual",
    workforceGroup: row.workforceGroup as WorkforceGroupKey,
    department: row.department,
    isManuallyAssigned: true,
    expectedStartDate: row.expectedStartDate,
    functionDescription: null,
    sectionDescription: null,
    workLocDescription: row.workLocDescription,
    createdDate: row.createdAt.toLocaleDateString("en-US"),
    createdBy: row.createdByEmail,
    modifiedBy: row.updatedByEmail,
    remote: row.remote,
    internal: row.internal,
  };
}

export async function getHiringPositions(): Promise<HiringPositionsResult> {
  const [manualRows, assignments] = await Promise.all([getCreatedHiringPositions(), getHiringAssignments()]);
  const manualPositions = manualRows.map(toManualPosition);

  let sourceRows: HiringPositionSourceRow[];
  try {
    sourceRows = await readHiringWorkbook();
  } catch (err) {
    return { positions: manualPositions, error: err instanceof Error ? err.message : "Couldn't read the hiring positions workbook." };
  }

  const byId = new Map(assignments.map((a) => [a.positionSourceId, a]));
  const workbookPositions = sourceRows.map((row) => toWorkbookPosition(row, byId.get(row.sourceId)));

  return { positions: [...workbookPositions, ...manualPositions], error: null };
}

export async function getHiringPositionById(sourceId: string): Promise<HiringPosition | null> {
  const { positions } = await getHiringPositions();
  return positions.find((p) => p.sourceId === sourceId) ?? null;
}
