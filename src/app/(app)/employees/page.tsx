import { prisma } from "@/lib/prisma";
import { PageTitle } from "@/components/ui/Typography";
import { ImportSupervisorsButton } from "@/components/ImportSupervisorsButton";
import { ReconcileRosterButton } from "@/components/ReconcileRosterButton";
import { EmployeesGrid } from "@/components/EmployeesGrid";
import { DISCIPLINE_LABELS } from "@/lib/disciplines";
import type { EmployeeRow } from "@/components/EmployeesTable";
import { fetchEmployeeTeams } from "@/lib/employee-team-field";

// Team groupings, matching the SDC Scheduler app's team_members.discipline
// categories. Now a sortable AG Grid column (Community can't do row grouping).
const DISCIPLINES = DISCIPLINE_LABELS;
const DASH = "—";

// Replaces the "Employees" tab of Project Planner Data Control.xlsx.
// Soft-delete only: deactivating keeps every historical hour intact.
//
// Read-only view — see EmployeesTable. The roster's fields all have upstream
// owners (Scheduler for discipline, Paylocity for name/department/supervisor),
// so it is maintained through the toolbar's sync and import buttons rather than
// by typing into cells.
export default async function EmployeesPage() {
  const employees = await prisma.employee.findMany({
    orderBy: [{ discipline: "asc" }, { name: "asc" }],
  });
  const teamById = await fetchEmployeeTeams();

  // id → name across the WHOLE roster, so a supervisor who has since been
  // deactivated still resolves to a name instead of showing as a dash.
  const nameById = new Map(employees.map((e) => [e.id, e.name]));

  const rows: EmployeeRow[] = employees.map((e) => ({
    id: e.id,
    name: e.name,
    discipline: DISCIPLINES.includes(e.discipline ?? "") ? (e.discipline as string) : DASH,
    supervisor: e.supervisorId != null ? (nameById.get(e.supervisorId) ?? DASH) : DASH,
    department: e.department ?? "",
    team: teamById.get(e.id) ?? null,
    active: e.active,
    billingGroup: e.billingGroup ?? "",
    paylocityId: e.paylocityId ?? "",
  }));

  return (
    <div className="w-full px-8 py-10 md:px-13 md:py-11">
      <div className="mb-1 flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageTitle className="mb-1">Employees</PageTitle>
          <p className="text-sm text-sdc-gray-600">
            Replaces the Project Planner workbook&apos;s Employees tab. One card per team, in the order the work moves through them. Deactivated employees keep all historical hours. Team grouping is shared live with SDC Scheduler&apos;s board — the roster here is read-only, maintained through the import button and Scheduler&apos;s own board.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ReconcileRosterButton />
          <ImportSupervisorsButton />
        </div>
      </div>

      <div className="mt-5">
        <EmployeesGrid rows={rows} disciplines={DISCIPLINES} />
      </div>
    </div>
  );
}
