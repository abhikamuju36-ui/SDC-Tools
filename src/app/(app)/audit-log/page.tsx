import { prisma } from "@/lib/prisma";
import { PageTitle } from "@/components/ui/Typography";
import { AuditLogGrid } from "@/components/AuditLogGrid";

// How many recent entries to load into the grid (AG Grid then sorts/filters/
// paginates them client-side).
const LOAD_LIMIT = 1000;

// Password-protected view of AuditLog — every logged data-changing action. AG
// Grid (Community) provides sort / column filters / resize / pagination
// client-side.
//
// The gate is layout.tsx's PasswordGate (audit-log-gate.ts), which renders in
// front of this page and is the real boundary. There used to be a
// `role !== "ADMIN" -> redirect("/")` here as well, and between it and the
// sidebar hiding the link, the password gate was unreachable for anyone who
// wasn't already an admin — belt and braces where the braces made the belt
// pointless. Dropped 2026-08-02 along with the app's other role gates: this
// app has one shared team password, not a role hierarchy, and gates that
// nobody can reach are how corrections stop happening.
export default async function AuditLogPage() {
  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: LOAD_LIMIT }),
    prisma.auditLog.count(),
  ]);

  const rows = logs.map((log) => ({
    when: log.createdAt.toISOString().slice(0, 16).replace("T", " "),
    userEmail: log.userEmail ?? "—",
    action: log.action,
    entity: log.entityType ? `${log.entityType}${log.entityId ? ` #${log.entityId}` : ""}` : "—",
    summary: log.summary ?? "",
  }));

  return (
    <div className="w-full p-8">
      <PageTitle className="mb-1">Audit Log</PageTitle>
      <p className="mb-6 text-sm text-sdc-gray-600">
        Every recorded data change across the app — ETC edits, employee/job changes, Standard Sheet edits,
        month submit/reopen/refresh, and sign-ins. {total.toLocaleString()} total{" "}
        {total === 1 ? "entry" : "entries"}
        {total > LOAD_LIMIT ? ` (showing the latest ${LOAD_LIMIT.toLocaleString()})` : ""}. Sort or filter any column.
      </p>
      <AuditLogGrid rows={rows} />
    </div>
  );
}
