import { prisma } from "@/lib/prisma";
import { PageTitle } from "@/components/ui/Typography";
import { ImportSupervisorsButton } from "@/components/ImportSupervisorsButton";
import { ReconcileRosterButton } from "@/components/ReconcileRosterButton";
import { EmployeesGrid } from "@/components/EmployeesGrid";
import { DISCIPLINE_LABELS } from "@/lib/disciplines";
import type { EmployeeRow } from "@/components/EmployeesCards";
import { fetchEmployeeTeams } from "@/lib/employee-team-field";
import { fetchSchedulerPlaceholders } from "@/lib/scheduler-db";
import { fetchSchedulerOverlay } from "@/lib/employee-scheduler-overlay";
import { normalizeName } from "@/lib/sync-scheduler-team";
import { requirePagePermission } from "@/lib/require-permission";
import { hasPermission } from "@/lib/permissions";
import { getHiringPositions } from "@/lib/hiring-positions";

// Team groupings, matching the SDC Scheduler app's team_members.discipline
// categories. Now a sortable AG Grid column (Community can't do row grouping).
const DISCIPLINES = DISCIPLINE_LABELS;
const DASH = "—";

// Replaces the "Employees" tab of Project Planner Data Control.xlsx.
// Soft-delete only: deactivating keeps every historical hour intact.
//
// Read-only view — see EmployeesCards. The roster's fields all have upstream
// owners (Scheduler for discipline, Paylocity for name/department/supervisor),
// so it is maintained through the toolbar's sync and import buttons rather than
// by typing into cells.
export default async function EmployeesPage() {
  const session = await requirePagePermission("employees:view");
  const employees = await prisma.employee.findMany({
    orderBy: [{ discipline: "asc" }, { name: "asc" }],
  });
  // team is Scheduler-authoritative; isLead/specialty are read live off the
  // SAME source (see employee-scheduler-overlay.ts) — both fail soft to
  // "nothing extra shown" if the Scheduler DB isn't reachable, so a roster
  // load never depends on Scheduler being up.
  const [teamById, overlayByName, placeholders, hiring] = await Promise.all([
    fetchEmployeeTeams(),
    fetchSchedulerOverlay(),
    fetchSchedulerPlaceholders(),
    getHiringPositions(),
  ]);

  // id → name across the WHOLE roster, so a supervisor who has since been
  // deactivated still resolves to a name instead of showing as a dash.
  const nameById = new Map(employees.map((e) => [e.id, e.name]));

  const rows: EmployeeRow[] = employees.map((e) => {
    const overlay = overlayByName.get(normalizeName(e.name));
    return {
      id: e.id,
      name: e.name,
      discipline: DISCIPLINES.includes(e.discipline ?? "") ? (e.discipline as string) : DASH,
      positionTitle: e.positionTitle?.trim() || DASH,
      supervisor: e.supervisorId != null ? (nameById.get(e.supervisorId) ?? DASH) : DASH,
      department: e.department ?? "",
      team: teamById.get(e.id) ?? null,
      active: e.active,
      billingGroup: e.billingGroup ?? "",
      paylocityId: e.paylocityId ?? "",
      isLead: overlay?.isLead ?? false,
      specialty: overlay?.specialty ?? null,
      sortOrder: overlay?.sortOrder ?? null,
    };
  });

  const canAddEmployees = hasPermission(session.user.role, "employees:edit");
  const canAssignHiring = hasPermission(session.user.role, "employees:hiring:assign");
  // Plain server-computed year, threaded down as a prop -- keeps
  // workforce-capacity-policy.ts/workforce-capacity.ts pure and testable
  // independent of the system clock, and leaves a clean seam for a future
  // year-selector.
  const year = new Date().getFullYear();

  return (
    <div className="w-full px-8 py-10 md:px-13 md:py-11">
      <div className="mb-1 flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageTitle className="mb-1">Employees</PageTitle>
          <p className="text-sm text-sdc-gray-600">
            Replaces the Project Planner workbook&apos;s Employees tab. Start at the Engineering / Shop / PM workforce
            overview, then drill into a department&apos;s card and a person&apos;s own detail. Deactivated employees
            keep all historical hours. Team grouping is shared live with SDC Scheduler&apos;s board — the roster here
            is read-only, maintained through the import button and Scheduler&apos;s own board.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ReconcileRosterButton />
          <ImportSupervisorsButton />
        </div>
      </div>

      <div className="mt-5">
        <EmployeesGrid
          rows={rows}
          disciplines={DISCIPLINES}
          placeholders={placeholders}
          canAddEmployees={canAddEmployees}
          hiringPositions={hiring.positions}
          hiringError={hiring.error}
          canAssignHiring={canAssignHiring}
          year={year}
        />
      </div>
    </div>
  );
}
