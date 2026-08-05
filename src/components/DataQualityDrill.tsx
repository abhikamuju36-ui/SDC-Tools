"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { getEmployeePunches, type EmployeePunchDetail } from "@/lib/data-quality-actions";
import type { PunchIssue } from "@/lib/data-quality";

// Drill-through for the Data Quality findings, following what the Power BI
// report actually offers rather than inventing new destinations. Its pages drill
// on exactly two fields:
//   • Job Id      -> "Job Detail" / "Assembly"  => /job-hours?jobs=<jobId> here
//   • Employee    -> "Hours Detail"             => the inline panel below
//
// Right-click opens the menu, as in Power BI. Left-clicking the row does the job
// drill directly, since that's the one people want nine times out of ten and
// making them right-click for it would be worse than the report, not the same.
//
// The menu is portaled to <body>: these tables scroll inside a fixed-height box,
// and an absolutely-positioned menu would be clipped by it.

const TH = "px-2 py-1.5 text-left text-label font-bold uppercase tracking-wide text-white";
const TD = "px-2 py-1 text-left text-note text-sdc-navy";

export function DataQualityDrill({ rows, showCompleted }: { rows: PunchIssue[]; showCompleted?: boolean }) {
  const router = useRouter();
  const [menu, setMenu] = useState<{ x: number; y: number; row: PunchIssue } | null>(null);
  const [panel, setPanel] = useState<EmployeePunchDetail | null>(null);
  const [pending, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    // capture, so a scroll inside the table (which doesn't bubble) closes it too
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", close, true);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", close, true);
    };
  }, [menu]);

  function openJob(row: PunchIssue) {
    setMenu(null);
    router.push(`/job-hours?jobs=${encodeURIComponent(row.jobId)}`);
  }

  function openEmployee(row: PunchIssue) {
    setMenu(null);
    startTransition(async () => {
      setPanel(await getEmployeePunches(row.employeeId));
    });
  }

  const ITEM =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-note text-sdc-navy hover:bg-sdc-gray-100 focus:bg-sdc-gray-100 focus:outline-none";

  return (
    <>
      <div className="max-h-72 overflow-auto rounded-lg border border-sdc-border styled-scrollbar">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-[1] bg-sdc-navy">
            <tr>
              <th className={TH}>Date</th>
              <th className={TH}>Employee</th>
              <th className={TH}>Department</th>
              <th className={TH}>Job</th>
              {showCompleted && <th className={TH}>Completed</th>}
              <th className={TH}>Section</th>
              <th className={`${TH} text-right`}>Hours</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={`${r.employeeId}-${r.date}-${r.section}-${i}`}
                onClick={() => openJob(r)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, row: r });
                }}
                title="Click for this job's hours · right-click to drill by employee"
                className={`cursor-pointer hover:bg-sdc-blue-light/50 ${i % 2 === 1 ? "bg-sdc-gray-50/60" : ""}`}
              >
                <td className={`${TD} whitespace-nowrap font-mono text-label`}>{r.date}</td>
                <td className={TD}>{r.employee}</td>
                <td className={`${TD} text-sdc-gray-500`}>{r.department}</td>
                <td className={TD} title={r.jobName}>
                  <span className="font-mono text-label text-sdc-gray-500">{r.jobId}</span> {r.jobName}
                </td>
                {showCompleted && <td className={`${TD} whitespace-nowrap font-mono text-label text-sdc-gray-500`}>{r.completeDate ?? "—"}</td>}
                <td className={`${TD} font-mono text-label`}>{r.section}</td>
                <td className={`${TD} text-right font-mono tabular-nums`}>{r.hours}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {menu &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 120), zIndex: 60 }}
            className="min-w-[220px] overflow-hidden rounded-md border border-sdc-border bg-white py-1 shadow-lg"
          >
            <div className="truncate border-b border-sdc-border px-3 py-1 font-mono text-label text-sdc-gray-500">
              {menu.row.jobId} · {menu.row.date}
            </div>
            <button type="button" role="menuitem" className={ITEM} onClick={() => openJob(menu.row)}>
              Job Hour Details — {menu.row.jobId}
            </button>
            <button type="button" role="menuitem" className={ITEM} onClick={() => openEmployee(menu.row)}>
              All punches by {menu.row.employee}
            </button>
          </div>,
          document.body,
        )}

      {pending && <p className="mt-2 text-xs text-sdc-gray-400">Loading punches…</p>}

      {panel && <EmployeePanel detail={panel} onClose={() => setPanel(null)} />}
    </>
  );
}

// The unrecognised-ID table, drillable the same way. There is no job on these
// rows — the finding IS the employee — so a click goes straight to the employee
// drill rather than offering a menu with one useful item in it.
export function EmployeeIdDrill({ ids }: { ids: { employeeId: string; rows: number; hours: number }[] }) {
  const [panel, setPanel] = useState<EmployeePunchDetail | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-sdc-border">
        <table className="w-full border-collapse">
          <thead className="bg-sdc-navy">
            <tr>
              <th className={TH}>Payroll ID</th>
              <th className={`${TH} text-right`}>Punches</th>
              <th className={`${TH} text-right`}>Hours</th>
            </tr>
          </thead>
          <tbody>
            {ids.map((r, i) => (
              <tr
                key={r.employeeId}
                onClick={() => startTransition(async () => setPanel(await getEmployeePunches(r.employeeId)))}
                title="Click to see everything this ID has booked"
                className={`cursor-pointer hover:bg-sdc-blue-light/50 ${i % 2 === 1 ? "bg-sdc-gray-50/60" : ""}`}
              >
                <td className={`${TD} font-mono`}>#{r.employeeId}</td>
                <td className={`${TD} text-right tabular-nums`}>{r.rows.toLocaleString()}</td>
                <td className={`${TD} text-right tabular-nums`}>{Math.round(r.hours).toLocaleString()}h</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pending && <p className="mt-2 text-xs text-sdc-gray-400">Loading punches…</p>}
      {panel && <EmployeePanel detail={panel} onClose={() => setPanel(null)} />}
    </>
  );
}

// The employee drill — the report's "Hours Detail" page filtered to one person.
// Everything they booked, newest first, across every job.
function EmployeePanel({ detail, onClose }: { detail: EmployeePunchDetail; onClose: () => void }) {
  return (
    <div className="mt-3 rounded-lg border border-sdc-blue-100 bg-white p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-sdc-navy">
            {detail.name ?? `Payroll ID #${detail.employeeId}`}
            {detail.department && <span className="ml-2 text-xs font-normal text-sdc-gray-500">{detail.department}</span>}
          </p>
          <p className="text-note text-sdc-gray-500">
            {detail.rows.length.toLocaleString()} punches · {Math.round(detail.total).toLocaleString()}h
            {detail.truncated && " (most recent 500)"}
            {/* An unresolved ID is the finding itself, so name it here too rather
                than leaving the reader to notice the heading is a number. */}
            {detail.name === null && " · this ID matches nobody on the roster"}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 rounded p-1 text-sdc-gray-400 hover:text-sdc-navy">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 4 L12 12 M12 4 L4 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="max-h-72 overflow-auto rounded-lg border border-sdc-border styled-scrollbar">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-[1] bg-sdc-navy">
            <tr>
              <th className={TH}>Date</th>
              <th className={TH}>Job</th>
              <th className={TH}>Status</th>
              <th className={TH}>Section</th>
              <th className={`${TH} text-right`}>Hours</th>
            </tr>
          </thead>
          <tbody>
            {detail.rows.map((r, i) => (
              <tr key={`${r.date}-${r.jobId}-${r.section}-${i}`} className={i % 2 === 1 ? "bg-sdc-gray-50/60" : ""}>
                <td className={`${TD} whitespace-nowrap font-mono text-label`}>{r.date}</td>
                <td className={TD} title={r.jobName}>
                  <span className="font-mono text-label text-sdc-gray-500">{r.jobId}</span> {r.jobName}
                </td>
                <td className={`${TD} text-sdc-gray-500`}>{r.jobStatus}</td>
                <td className={`${TD} font-mono text-label`} title={r.sectionName}>
                  {r.section}
                </td>
                <td className={`${TD} text-right font-mono tabular-nums`}>{r.hours}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
