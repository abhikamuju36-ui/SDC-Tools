"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { nextParams, notePendingParams } from "@/lib/url-params";

// Column visibility controls for the Monthly ETC grid. Toggles the `dept`
// query param (comma-separated billing groups) to hide section-column blocks,
// and the `jobname` param ("0" = hidden) to hide the Job Name column. Same
// dropdown interaction as PhaseColumnPicker/MultiSelectFilter, but scoped to
// /etc and preserving the current month. Selecting both groups (or none)
// drops the dept param so the default is the full grid — you can never hide
// every section column.
const GROUPS = ["Engineering", "Shop"] as const;

export function DeptColumnFilter({ selected, showJobName }: { selected: string[]; showJobName: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const selectedSet = new Set(selected.length ? selected : GROUPS);
  const checkedCount = GROUPS.filter((g) => selectedSet.has(g)).length;
  const allChecked = checkedCount === GROUPS.length && showJobName;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (detailsRef.current?.open && !detailsRef.current.contains(e.target as Node)) {
        detailsRef.current.open = false;
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  function navigate(next: Set<string>) {
    // This one navigates on EVERY tick, so a second tick almost always lands
    // while the first is still rendering — exactly the case where
    // useSearchParams still reports the older value. See lib/url-params.ts.
    const currentQs = searchParams.toString();
    const qs = nextParams(currentQs);
    // Both (or none) is the default full grid — keep the URL clean and never
    // let the grid collapse to zero section columns.
    if (next.size === 0 || next.size === GROUPS.length) qs.delete("dept");
    else qs.set("dept", GROUPS.filter((g) => next.has(g)).join(","));
    const q = qs.toString();
    notePendingParams(currentQs, q);
    router.push(`/etc?${q}`, { scroll: false });
  }

  function toggle(group: string) {
    const next = new Set(selectedSet);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    navigate(next);
  }

  function toggleJobName() {
    const currentQs = searchParams.toString();
    const qs = nextParams(currentQs);
    // Shown is the default — keep the URL clean unless hidden.
    if (showJobName) qs.set("jobname", "0");
    else qs.delete("jobname");
    const q = qs.toString();
    notePendingParams(currentQs, q);
    router.push(`/etc?${q}`, { scroll: false });
  }

  return (
    <details ref={detailsRef} className="group relative inline-block">
      <summary
        className={`flex list-none cursor-pointer select-none items-center gap-1.5 rounded-md border px-3.5 py-1.5 text-sm font-medium shadow-sm ${
          allChecked
            ? "border-sdc-border bg-white text-sdc-navy hover:bg-sdc-blue-light"
            : "border-sdc-blue bg-sdc-blue-light text-sdc-blue-dark"
        }`}
      >
        Columns
        {!allChecked && " (filtered)"}
        <svg
          viewBox="0 0 16 16"
          width="10"
          height="10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="shrink-0 opacity-70 motion-interactive group-open:rotate-180"
        >
          <path d="M3.5 6 L8 10.5 L12.5 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="motion-menu-panel absolute left-0 top-full z-30 mt-2 w-48 rounded-lg border border-sdc-border bg-white p-2 shadow-lg">
        <p className="px-1.5 pb-1 text-note text-sdc-gray-400">Show section columns for:</p>
        {GROUPS.map((g) => (
          <label key={g} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-sdc-gray-100">
            <input type="checkbox" checked={selectedSet.has(g)} onChange={() => toggle(g)} className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{g}</span>
          </label>
        ))}
        <p className="mt-1 border-t border-sdc-border px-1.5 pb-1 pt-2 text-note text-sdc-gray-400">Grid columns:</p>
        <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-sdc-gray-100">
          <input type="checkbox" checked={showJobName} onChange={toggleJobName} className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">Job Name</span>
        </label>
      </div>
    </details>
  );
}
