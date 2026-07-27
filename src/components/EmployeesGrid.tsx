"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import type { EmployeeRow } from "@/components/EmployeesGridInner";

// AG Grid touches `window`, so load client-only (no SSR).
const Inner = dynamic(() => import("@/components/EmployeesGridInner"), {
  ssr: false,
  loading: () => <div className="h-[78vh] w-full animate-pulse rounded-xl bg-sdc-gray-50" />,
});

export function EmployeesGrid({
  rows,
  disciplines,
  supervisors,
}: {
  rows: EmployeeRow[];
  disciplines: string[];
  supervisors: { id: number; name: string }[];
}) {
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const visible = useMemo(() => (showInactive ? rows : rows.filter((r) => r.active)), [rows, showInactive]);
  const activeCount = rows.filter((r) => r.active).length;

  // While searching with inactive hidden, count how many INACTIVE people match
  // so we can offer to reveal them — otherwise a departed employee is
  // unfindable (search only filters the visible/active rows) and reactivation,
  // the whole point of soft-delete, is hard to discover.
  const hiddenInactiveMatches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || showInactive) return 0;
    return rows.filter(
      (r) =>
        !r.active &&
        [r.name, r.discipline, r.supervisor, r.department].some((v) => String(v ?? "").toLowerCase().includes(s)),
    ).length;
  }, [rows, q, showInactive]);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5 rounded-lg border border-sdc-border bg-white px-3.5">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sdc-gray-400">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="w-56 border-none bg-transparent py-2 text-sm text-sdc-navy outline-none placeholder:text-sdc-gray-400"
          />
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-sdc-gray-600">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-3.5 w-3.5" />
          Show inactive
        </label>
        <span className="text-xs text-sdc-gray-400">
          {activeCount} active{showInactive ? ` · ${rows.length - activeCount} inactive` : ""}
        </span>
        {hiddenInactiveMatches > 0 && (
          <button
            type="button"
            onClick={() => setShowInactive(true)}
            className="text-xs font-medium text-sdc-blue hover:underline"
          >
            {hiddenInactiveMatches} inactive {hiddenInactiveMatches === 1 ? "person matches" : "people match"} — show them
          </button>
        )}
      </div>
      <Inner rows={visible} disciplines={disciplines} supervisors={supervisors} quickFilter={q} />
    </>
  );
}
