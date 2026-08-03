import "server-only";
import { prisma } from "@/lib/prisma";
import { SECTIONS } from "@/lib/sections";
import { fetchJobHoursRowsWithIssues } from "@/lib/job-hours-source";
import type { JobHoursDetail } from "@/lib/job-hours-detail";

// Punch-level detail behind the "Unattributed hours" KPI card — the time booked
// to something that isn't a job number ("Not Defined", "2026 SERVICE") and so
// reaches no figure anywhere on the ETC page.
//
// The card's headline comes from HoursImportIssue, written by the sync. This
// reads the EXPORT instead, because the stored table only keeps per-label totals
// and a total is not actionable: fixing this means opening Paylocity and
// correcting specific entries, which needs a name, a date and a section.
//
// Read on demand rather than persisted, deliberately: it costs one ~900ms parse
// of a file the app already reads on every sync, against a schema change and a
// second copy of data whose only consumer is one drill panel. The trade-off is
// that this can disagree with the card if the file has changed since the last
// sync — so the caller is handed both totals and the panel says so, the same way
// the Engineering/Shop drills already do. A silent disagreement between a card
// and its own drill is the failure this app has already been bitten by (DEVLOG
// §12); a stated one is fine.
//
// Reuses JobHoursDetail's shape so the existing HoursDetailPanel renders it with
// no changes — the `job` column carries the offending label, which is exactly
// what the row is identified by.

const SECTION_NAME = new Map(SECTIONS.map((s) => [s.code, s.name]));

export type UnattributedDetail = JobHoursDetail & {
  // What the sync stored, for comparison against `total` above.
  storedTotal: number;
};

export async function getUnattributedDetail(month: string): Promise<UnattributedDetail> {
  const [{ unattributed }, employees, stored] = await Promise.all([
    fetchJobHoursRowsWithIssues(),
    prisma.employee.findMany({
      where: { paylocityId: { not: null } },
      select: { paylocityId: true, name: true, department: true },
    }),
    prisma.hoursImportIssue.findMany({ where: { month }, select: { hours: true } }),
  ]);

  const byPaylocityId = new Map(employees.map((e) => [e.paylocityId!, e]));
  const forMonth = unattributed.filter((u) => u.month === month);

  const rows = forMonth
    .map((u) => {
      const emp = byPaylocityId.get(u.employeeId);
      return {
        date: u.date.toISOString().slice(0, 10),
        employee: emp?.name ?? (u.employeeId ? `#${u.employeeId}` : "—"),
        department: emp?.department ?? "—",
        section: u.section,
        // 10-311 is counted here un-split: it is rejected before the design/
        // software split happens, so showing it as two lines would invent detail
        // the export never carried.
        sectionName: SECTION_NAME.get(u.section) ?? u.section,
        hours: u.hours,
        job: u.label, // the raw cell value that isn't a job number
      };
    })
    .sort((a, b) => (a.date === b.date ? b.hours - a.hours : b.date.localeCompare(a.date)));

  // The panel's section filter, built from what's actually present.
  const bySection = new Map<string, number>();
  for (const r of rows) bySection.set(r.section, (bySection.get(r.section) ?? 0) + r.hours);

  return {
    rows,
    total: rows.reduce((s, r) => s + r.hours, 0),
    sections: [...bySection.entries()]
      .map(([code, hours]) => ({ code, name: SECTION_NAME.get(code) ?? code, hours }))
      .sort((a, b) => b.hours - a.hours),
    truncated: false, // bounded by how much bad data exists; 56 entries in 2026-07
    storedTotal: stored.reduce((s, i) => s + Number(i.hours), 0),
  };
}
