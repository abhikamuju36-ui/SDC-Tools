"use client";

import { Fragment, useMemo } from "react";
import { useRouter } from "next/navigation";
import { updateEmployee } from "@/lib/employee-actions";
import { useToast } from "@/components/ui/Toast";
import { DragScroll } from "@/components/DragScroll";
import { TABLE_HEADER_ROW, TABLE_GRID } from "@/components/ui/classnames";

// The employee roster, as a plain spreadsheet-style table.
//
// Replaces the AG Grid version (EmployeesGridInner). Nothing about the data
// changed — it's the same department grouping, the same inline editing, the same
// save-on-change — but it now uses the app's own table primitives (TABLE_GRID /
// TABLE_HEADER_ROW), so it reads like the Projects and Monthly ETC grids instead
// of a differently-themed widget with its own row heights, its own filter row,
// and full-bleed navy group bars.
//
// What went away with AG Grid, deliberately:
//   • the floating-filter row under the header — the Discipline/Dept dropdowns
//     moved up into the toolbar, where the search box already lives
//   • ~700ms of client JS and a client-only dynamic import; this renders on the
//     server like every other grid here
//   • the navy full-width group bars, now a light band that doesn't shout over
//     the data it's labelling
export const DASH = "—"; // display value for "no discipline / no supervisor"

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

const NO_DEPT = "No department"; // bucket for employees with a blank Dept

// Cell chrome, shared by every column so the row reads as one grid line. The
// `[&>*]` reach-in styles whatever control the cell holds (input/select) rather
// than repeating the same classes on each one.
const CELL =
  "border-sdc-border px-2 py-1 text-left align-middle text-[11px] text-sdc-navy " +
  "[&>input]:w-full [&>input]:min-w-0 [&>input]:bg-transparent [&>input]:outline-none " +
  "[&>select]:w-full [&>select]:min-w-0 [&>select]:bg-transparent [&>select]:outline-none";

export function EmployeesTable({
  rows,
  disciplines,
  supervisors,
}: {
  rows: EmployeeRow[];
  disciplines: string[];
  supervisors: { id: number; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const supByName = useMemo(() => new Map(supervisors.map((s) => [s.name, s.id])), [supervisors]);

  // Department-grouped: one header row per department, then that department's
  // people A→Z. "No department" always sorts last.
  const groups = useMemo(() => {
    const byDept = new Map<string, EmployeeRow[]>();
    for (const r of rows) {
      const dept = r.department?.trim() && r.department !== DASH ? r.department.trim() : NO_DEPT;
      const list = byDept.get(dept);
      if (list) list.push(r);
      else byDept.set(dept, [r]);
    }
    return [...byDept.keys()]
      .sort((a, b) => (a === NO_DEPT ? 1 : b === NO_DEPT ? -1 : a.localeCompare(b)))
      .map((dept) => ({
        dept,
        people: byDept.get(dept)!.slice().sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }, [rows]);

  // One save path for every editable cell — the row as it should now be, with
  // the one changed field patched in. Fires on change/blur, same as the old
  // grid's onCellValueChanged, so there's no per-row Save button to hunt for.
  function save(row: EmployeeRow, patch: Partial<EmployeeRow>) {
    const next = { ...row, ...patch };
    const fd = new FormData();
    fd.set("name", next.name ?? "");
    fd.set("department", next.department ?? "");
    fd.set("billingGroup", next.billingGroup ?? "");
    fd.set("paylocityId", next.paylocityId ?? "");
    fd.set("discipline", next.discipline && next.discipline !== DASH ? next.discipline : "");
    const supId = next.supervisor && next.supervisor !== DASH ? supByName.get(next.supervisor) : undefined;
    fd.set("supervisorId", supId != null ? String(supId) : "");
    // Feedback on both outcomes — the action can reject (e.g. a duplicate
    // Paylocity ID), and that failure must not pass silently.
    updateEmployee(next.id, fd)
      .then(() => {
        toast(`Saved ${next.name}`);
        router.refresh();
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : "Couldn't save this employee.", "error"));
  }

  const total = groups.reduce((s, g) => s + g.people.length, 0);

  return (
    <DragScroll className="max-h-[calc(100vh-190px)] overflow-auto rounded-xl border border-sdc-border bg-white shadow-sm select-none styled-scrollbar">
      <table className={`w-full text-sm ${TABLE_GRID}`}>
        <thead className="sticky top-0 z-20 bg-sdc-navy">
          <tr className={`${TABLE_HEADER_ROW} [&>th]:px-2 [&>th]:py-2 [&>th]:text-left [&>th]:text-white`}>
            <th className="w-10">#</th>
            <th className="min-w-[180px]">Name</th>
            <th className="w-44">Discipline</th>
            <th className="w-44">Supervisor</th>
            <th className="w-44">Dept</th>
            <th className="w-20">Status</th>
          </tr>
        </thead>
        <tbody>
          {total === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-sdc-gray-400">
                No employees match.
              </td>
            </tr>
          )}
          {groups.map((g) => (
            <Fragment key={g.dept}>
              <tr>
                {/* Department band. Brand light-blue with a solid blue rule down
                    its left edge and a divider above — enough to break the
                    roster into blocks you can find while scrolling, without
                    going back to the full-bleed navy bar that outshouted the
                    column headers. Blue (not gray) because these are structural
                    dividers, and gray reads as just another data row. */}
                <td
                  colSpan={6}
                  className="border-t-2 border-t-sdc-blue-100 border-l-[3px] border-l-sdc-blue bg-sdc-blue-light px-2 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold tracking-wider text-sdc-navy uppercase">{g.dept}</span>
                    <span className="shrink-0 text-[10px] font-semibold tabular-nums text-sdc-blue-dark/70">
                      {g.people.length} {g.people.length === 1 ? "employee" : "employees"}
                    </span>
                  </div>
                </td>
              </tr>
              {g.people.map((p, i) => (
                <tr key={p.id} className={`hover:bg-sdc-blue-light/40 ${i % 2 === 1 ? "bg-sdc-gray-50/60" : ""}`}>
                  {/* Per-department line numbers, so # restarts at 1 in each group. */}
                  <td className={`${CELL} tabular-nums text-sdc-gray-400`}>{i + 1}</td>
                  <td className={CELL}>
                    <input
                      type="text"
                      defaultValue={p.name}
                      aria-label={`Name, ${p.name}`}
                      // onBlur, not onChange: a name is typed a character at a
                      // time and one save per keystroke would hammer the action.
                      onBlur={(e) => {
                        if (e.target.value !== p.name) save(p, { name: e.target.value });
                      }}
                    />
                  </td>
                  <td className={CELL}>
                    <select
                      defaultValue={p.discipline}
                      aria-label={`Discipline, ${p.name}`}
                      onChange={(e) => save(p, { discipline: e.target.value })}
                    >
                      <option value={DASH}>{DASH}</option>
                      {disciplines.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={CELL}>
                    <select
                      defaultValue={p.supervisor}
                      aria-label={`Supervisor, ${p.name}`}
                      onChange={(e) => save(p, { supervisor: e.target.value })}
                    >
                      <option value={DASH}>{DASH}</option>
                      {supervisors.map((s) => (
                        <option key={s.id} value={s.name}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={CELL}>
                    <input
                      type="text"
                      defaultValue={p.department}
                      aria-label={`Department, ${p.name}`}
                      onBlur={(e) => {
                        if (e.target.value !== p.department) save(p, { department: e.target.value });
                      }}
                    />
                  </td>
                  <td className={`${CELL} ${p.active ? "text-sdc-blue-dark" : "text-sdc-gray-500"} font-semibold`}>
                    {p.active ? "Active" : "Inactive"}
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </DragScroll>
  );
}
