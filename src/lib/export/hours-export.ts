import { queryHoursExportRows } from "@/lib/hours-explorer";
import { parseHoursFilters, describeHoursFilters, type HoursSearchParams } from "@/lib/hours-filters";
import type { CellValue, SheetColumn, SheetSpec } from "@/lib/export/sheet";

// ── The Hours tab, as a spreadsheet ─────────────────────────────────────────
//
// Same pipeline Projects/Monthly ETC already use (SheetSpec -> buildCsv/buildXlsx), and
// the SAME filter parsing (hours-filters.ts's parseHoursFilters) and the SAME query
// (hours-explorer.ts) the page's table uses — so the file matches the table the manager
// was looking at, the guarantee lib/projects-query.ts gives the Projects export.

export type HoursExportResult = { spec: SheetSpec; rowCount: number };

export async function buildHoursExport(params: HoursSearchParams, now: Date): Promise<HoursExportResult> {
  const filters = parseHoursFilters(params);
  const { rows, truncated } = await queryHoursExportRows(filters);

  const columns: SheetColumn[] = [
    { header: "Date", type: "date" },
    { header: "Employee", type: "text", width: 22 },
    { header: "Department", type: "text", width: 20 },
    { header: "Job Id", type: "text", width: 10 },
    { header: "Job Name", type: "text", width: 30 },
    { header: "Function / Section", type: "text", width: 22 },
    { header: "Hours", type: "hours" },
  ];

  const body: CellValue[][] = rows.map((r) => [
    new Date(`${r.date}T00:00:00.000Z`),
    r.employee,
    r.department,
    r.jobId,
    r.jobName,
    `${r.section} — ${r.sectionName}`,
    r.hours,
  ]);

  const totalHours = rows.reduce((s, r) => s + r.hours, 0);
  const totals: CellValue[] = columns.map((_, i) => (i === 0 ? `TOTAL (${rows.length} punches)` : i === 6 ? totalHours : null));

  const subtitle = [
    `Filters: ${describeHoursFilters(filters)}`,
    `Exported ${now.toISOString().slice(0, 16).replace("T", " ")} — ${rows.length} punch${rows.length === 1 ? "" : "es"}`,
  ];
  if (truncated) subtitle.push(`Truncated to the first ${rows.length.toLocaleString()} rows — narrow the filters for a complete export.`);

  return {
    rowCount: rows.length,
    spec: {
      sheetName: "Hours",
      title: "Hours",
      subtitle,
      columns,
      rows: body,
      totals,
      freezeColumns: 1,
    },
  };
}
