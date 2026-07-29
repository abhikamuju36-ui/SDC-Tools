"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { AgGridReact, type CustomFloatingFilterProps } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
} from "ag-grid-community";
import { updateEmployee, setEmployeeActive } from "@/lib/employee-actions";
import { useToast } from "@/components/ui/Toast";

ModuleRegistry.registerModules([AllCommunityModule]);

const sdcTheme = themeQuartz.withParams({
  accentColor: "#1574C4",
  headerBackgroundColor: "#061D39",
  headerTextColor: "#ffffff",
  headerFontWeight: 600,
  fontFamily: "inherit",
  fontSize: 8,
  headerFontSize: 8,
  rowHoverColor: "#e6f0fa",
  borderColor: "#e6e9ee",
  wrapperBorderRadius: 12,
  oddRowBackgroundColor: "#fafbfc",
});

const DASH = "—"; // display value for "no discipline / no supervisor"

export type EmployeeRow = {
  id: number;
  name: string;
  discipline: string; // label or DASH
  supervisor: string; // supervisor name or DASH
  department: string;
  active: boolean;
  billingGroup: string;
  paylocityId: string;
};

type GridContext = {
  onSave: (row: EmployeeRow) => void;
  onToggleActive: (row: EmployeeRow) => void;
  supByName: Map<string, number>;
};

const NO_DEPT = "No department"; // bucket for employees with a blank Dept

// The grid is fed a flat list where each department's employees are preceded by
// a synthetic header row (`__group` set). Those render as full-width rows —
// AG Grid Community has no rowGroup (Enterprise only), so this is how the
// "Dept 1, then all of Dept 1's people, then Dept 2…" layout is built.
// `seq` is the per-department line number, so the # column restarts at 1 in
// every group instead of counting header rows.
type GridRow = EmployeeRow & { __group?: string; __count?: number; seq?: number };

function GroupRowRenderer(p: ICellRendererParams<GridRow>) {
  const row = p.data;
  if (!row?.__group) return null;
  return (
    <div className="flex h-full w-full items-center justify-between gap-2 border-y border-sdc-navy bg-sdc-navy px-4">
      <span className="text-[13px] font-bold tracking-wide text-white">{row.__group}</span>
      <span className="whitespace-nowrap text-xs font-bold tabular-nums text-white/70">
        {row.__count} {row.__count === 1 ? "employee" : "employees"}
      </span>
    </div>
  );
}

// Community-safe replacement for the Enterprise Set Filter: a native dropdown
// of the column's known values, so Discipline/Department filter by picking a
// value directly instead of the text filter's Contains/Equals operators.
// Backed by the built-in agTextColumnFilter (via an "equals" model), so the
// grid's own filtering/quick-search all keep working.
function DropdownFloatingFilter(props: CustomFloatingFilterProps & { values: string[] }) {
  const { model, onModelChange, values } = props;
  const current = (model?.filter as string | undefined) ?? "";
  return (
    <select
      value={current}
      onChange={(e) => {
        const v = e.target.value;
        onModelChange(v ? { type: "equals", filter: v } : null);
      }}
      className="h-7 w-full rounded-md border border-sdc-border bg-white px-1.5 text-[12px] text-sdc-navy outline-none focus:border-sdc-blue"
    >
      <option value="">All</option>
      {values.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </select>
  );
}

function StatusRenderer(p: ICellRendererParams<EmployeeRow>) {
  const active = p.data?.active;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${active ? "bg-sdc-blue-light text-sdc-blue-dark" : "bg-sdc-gray-100 text-sdc-gray-500"}`}>
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function ActionsRenderer(p: ICellRendererParams<EmployeeRow>) {
  const ctx = p.context as GridContext;
  const row = p.data;
  if (!row) return null;
  return (
    <span className="flex items-center gap-2">
      <button type="button" onClick={() => ctx.onSave(row)} className="rounded-md border border-sdc-border px-2.5 py-0.5 text-[11px] font-semibold text-sdc-navy hover:bg-sdc-blue-light">
        Save
      </button>
      <button
        type="button"
        onClick={() => ctx.onToggleActive(row)}
        className={row.active
          ? "rounded-md border border-[#F0D6D6] px-2.5 py-0.5 text-[11px] font-semibold text-[#B03A3A] hover:bg-[#FBEDED]"
          : "rounded-md border border-sdc-border px-2.5 py-0.5 text-[11px] font-semibold text-sdc-navy hover:bg-sdc-blue-light"}
      >
        {row.active ? "Deactivate" : "Reactivate"}
      </button>
    </span>
  );
}

export default function EmployeesGridInner({
  rows,
  disciplines,
  supervisors,
  quickFilter,
}: {
  rows: EmployeeRow[];
  disciplines: string[];
  supervisors: { id: number; name: string }[];
  quickFilter?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const supByName = useMemo(() => new Map(supervisors.map((s) => [s.name, s.id])), [supervisors]);
  // Distinct departments present in the data, for the department dropdown filter.
  const departments = useMemo(
    () => Array.from(new Set(rows.map((r) => r.department).filter((d): d is string => !!d && d !== DASH))).sort(),
    [rows]
  );

  // Department-grouped row list: one header row per department, then that
  // department's employees A→Z. "No department" always sorts last.
  const groupedRows = useMemo<GridRow[]>(() => {
    const byDept = new Map<string, EmployeeRow[]>();
    for (const r of rows) {
      const dept = r.department?.trim() && r.department !== DASH ? r.department.trim() : NO_DEPT;
      const list = byDept.get(dept);
      if (list) list.push(r);
      else byDept.set(dept, [r]);
    }
    const depts = [...byDept.keys()].sort((a, b) =>
      a === NO_DEPT ? 1 : b === NO_DEPT ? -1 : a.localeCompare(b)
    );
    const out: GridRow[] = [];
    let headerId = -1;
    for (const dept of depts) {
      const people = byDept.get(dept)!.slice().sort((a, b) => a.name.localeCompare(b.name));
      // `department` is carried on the header row so the Dept dropdown filter
      // keeps the matching group's heading visible.
      out.push({
        id: headerId--,
        name: "",
        discipline: "",
        supervisor: "",
        department: dept === NO_DEPT ? "" : dept,
        active: true,
        billingGroup: "",
        paylocityId: "",
        __group: dept,
        __count: people.length,
      });
      people.forEach((p, i) => out.push({ ...p, seq: i + 1 }));
    }
    return out;
  }, [rows]);

  const context: GridContext = {
    supByName,
    onSave: (row) => {
      const fd = new FormData();
      fd.set("name", row.name ?? "");
      fd.set("department", row.department ?? "");
      fd.set("billingGroup", row.billingGroup ?? "");
      fd.set("paylocityId", row.paylocityId ?? "");
      fd.set("discipline", row.discipline && row.discipline !== DASH ? row.discipline : "");
      const supId = row.supervisor && row.supervisor !== DASH ? supByName.get(row.supervisor) : undefined;
      fd.set("supervisorId", supId != null ? String(supId) : "");
      // Feedback on both outcomes — the action can reject (e.g. duplicate
      // Paylocity ID) and previously that failure was swallowed silently.
      updateEmployee(row.id, fd)
        .then(() => {
          toast(`Saved ${row.name}`);
          router.refresh();
        })
        .catch((e: unknown) => toast(e instanceof Error ? e.message : "Couldn't save this employee.", "error"));
    },
    onToggleActive: (row) => {
      const next = !row.active;
      // Confirm deactivation — it removes the person from the default view and
      // the supervisor picker, so an accidental click is disorienting.
      if (!next && !window.confirm(`Deactivate ${row.name}? They keep all historical hours and can be reactivated any time.`)) return;
      setEmployeeActive(row.id, next, new FormData())
        .then(() => {
          toast(next ? `Reactivated ${row.name}` : `Deactivated ${row.name}`);
          router.refresh();
        })
        .catch((e: unknown) => toast(e instanceof Error ? e.message : "Couldn't update this employee.", "error"));
    },
  };

  const columnDefs: ColDef<GridRow>[] = [
    { headerName: "#", width: 64, valueGetter: (p) => p.data?.seq ?? "", sortable: false, filter: false, resizable: false },
    { field: "name", headerName: "Name", editable: true, minWidth: 180, flex: 1 },
    {
      field: "discipline",
      headerName: "Discipline",
      editable: true,
      width: 200,
      cellEditor: "agSelectCellEditor",
      cellEditorParams: { values: [DASH, ...disciplines] },
      filter: "agTextColumnFilter",
      suppressFloatingFilterButton: true,
      floatingFilterComponent: DropdownFloatingFilter,
      floatingFilterComponentParams: { values: disciplines },
    },
    { field: "supervisor", headerName: "Supervisor", editable: true, width: 200, cellEditor: "agSelectCellEditor", cellEditorParams: { values: [DASH, ...supervisors.map((s) => s.name)] } },
    {
      field: "department",
      headerName: "Dept",
      editable: true,
      width: 200,
      filter: "agTextColumnFilter",
      suppressFloatingFilterButton: true,
      floatingFilterComponent: DropdownFloatingFilter,
      floatingFilterComponentParams: { values: departments },
    },
    { field: "active", headerName: "Status", width: 120, editable: false, cellRenderer: StatusRenderer, valueGetter: (p) => (p.data?.active ? "Active" : "Inactive") },
    // Hidden by request. Kept (rather than deleted) because it's the only home
    // for Deactivate/Reactivate — flip `hide` to bring both buttons back.
    { headerName: "Actions", width: 190, hide: true, editable: false, sortable: false, filter: false, cellRenderer: ActionsRenderer },
  ];

  return (
    <div style={{ height: "calc(100vh - 175px)", width: "100%" }}>
      <AgGridReact<GridRow>
        theme={sdcTheme}
        rowData={groupedRows}
        columnDefs={columnDefs}
        context={context}
        getRowId={(p) => String(p.data.id)}
        // Header rows render across the full width; the column cells (Save /
        // Deactivate / Status) would be meaningless on them.
        isFullWidthRow={(p) => !!(p.rowNode.data as GridRow | undefined)?.__group}
        fullWidthCellRenderer={GroupRowRenderer}
        // Column sorting is off: the row order IS the grouping (department, then
        // name). Sorting by any column would scatter the header rows away from
        // the people they belong to. Filtering still works.
        defaultColDef={{ sortable: false, filter: true, resizable: true, floatingFilter: true }}
        suppressMenuHide
        quickFilterText={quickFilter}
        stopEditingWhenCellsLoseFocus
        // The Actions column (and with it the per-row Save button) is hidden, so
        // committing a cell edit is now what persists the row — otherwise a typed
        // change would be silently dropped on the next refresh.
        onCellValueChanged={(e) => {
          if (e.data?.__group) return; // department header row — nothing to save
          context.onSave(e.data);
        }}
        animateRows
      />
    </div>
  );
}
