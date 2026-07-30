"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { INPUT } from "@/components/ui/classnames";

// Searchable SINGLE-job picker for the Job Hour Details slicer. Writes
// ?jobs=<jobId>.
//
// Was a multi-select (checkboxes + removable chips + "Clear all") mirroring the
// Power BI job slicer. Two reasons it's one job now, by request: the page reads
// as a single-job report, and "remove the selected job" could never work — the
// server falls back to its data-richest default job whenever ?jobs= is absent
// (see defaultDashboardJobId), so clearing the last chip immediately re-selected
// 1142 and looked broken. With exactly one selection there's nothing to remove:
// picking a job replaces the one before it.
//
// The page still accepts a comma-separated ?jobs=a,b and aggregates it, so
// existing multi-job deep links keep working — this control just doesn't
// create them.
type JobOpt = { id: number; jobId: string; jobName: string; status: string | null };

// Status groups, in the order they appear in the list. Active leads because
// that's what nearly every lookup is for; the Power BI slicer this mirrors
// happens to sort "(Blank)" first, which buries the useful group. Any status not
// named here falls in between, alphabetically, so a new one added to the data
// shows up without a code change. Jobs with no status land in "(Blank)", the
// same label the Power BI slicer uses.
const BLANK_GROUP = "(Blank)";
const GROUP_ORDER_HEAD = ["Active"];
const GROUP_ORDER_TAIL = [BLANK_GROUP];

function groupRank(name: string): [number, string] {
  const head = GROUP_ORDER_HEAD.indexOf(name);
  if (head !== -1) return [head, ""];
  const tail = GROUP_ORDER_TAIL.indexOf(name);
  if (tail !== -1) return [2, String(tail)];
  return [1, name.toLowerCase()];
}

export function JobSelect({ jobs, selected }: { jobs: JobOpt[]; selected: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (detailsRef.current?.open && !detailsRef.current.contains(e.target as Node)) detailsRef.current.open = false;
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Remember the last selection so the page stops snapping back to the server's
  // data-richest default (1142) on every fresh landing. An explicit ?jobs= /
  // ?job= (e.g. a deep-link from Projects) always wins — we only restore when
  // the URL carries no selection at all.
  const LAST_KEY = "jobhours-last-jobs";
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.has("jobs") || sp.has("job")) return;
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(LAST_KEY); } catch { /* ignore */ }
    if (!stored) return;
    sp.set("jobs", stored);
    router.replace(`${pathname}?${sp.toString()}`);
    // Run once on mount — a stored value only matters for the initial landing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) => j.jobId.includes(q) || j.jobName.toLowerCase().includes(q));
  }, [jobs, query]);

  // Grouped by Job Status, like the Power BI slicer. Built from the FILTERED
  // list so a search narrows the groups too — and drops any group left empty
  // rather than showing a header with nothing under it.
  const groups = useMemo(() => {
    const byStatus = new Map<string, JobOpt[]>();
    for (const j of filtered) {
      const key = j.status?.trim() ? j.status : BLANK_GROUP;
      const list = byStatus.get(key);
      if (list) list.push(j);
      else byStatus.set(key, [j]);
    }
    return [...byStatus.entries()]
      .map(([name, items]) => ({ name, items }))
      .sort((a, b) => {
        const [ra, sa] = groupRank(a.name);
        const [rb, sb] = groupRank(b.name);
        return ra - rb || sa.localeCompare(sb);
      });
  }, [filtered]);

  // Which groups the user has explicitly toggled. Absent from the map = use the
  // default (below), so a brand-new status group behaves sensibly without ever
  // having been clicked.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const selectedStatus = selected ? jobs.find((j) => j.jobId === selected)?.status : null;
  function isOpen(name: string): boolean {
    if (name in overrides) return overrides[name];
    // While searching, open everything — a collapsed group would hide the match
    // the user just typed and read as "no results".
    if (query.trim()) return true;
    // Otherwise: Active, plus whichever group holds the current job, so the ✓ is
    // visible on open without any hunting. Everything else starts collapsed —
    // that's the point of grouping a 300-job list.
    if (name === "Active") return true;
    return name === (selectedStatus?.trim() ? selectedStatus : BLANK_GROUP);
  }

  function pick(jobId: string) {
    const qs = new URLSearchParams(searchParams.toString());
    qs.set("jobs", jobId);
    qs.delete("job"); // drop the legacy single-job param
    // Persist the pick so the next landing restores it (see the mount effect).
    try { window.localStorage.setItem(LAST_KEY, jobId); } catch { /* ignore */ }
    // Close and reset the search so the next open starts from the full list
    // rather than whatever was typed to find this job.
    if (detailsRef.current) detailsRef.current.open = false;
    setQuery("");
    router.push(`${pathname}?${qs.toString()}`);
  }

  const current = selected ? jobs.find((x) => x.jobId === selected) : undefined;
  const summary = current ? `${current.jobId} — ${current.jobName}` : (selected ?? "Select a job…");

  return (
    <details ref={detailsRef} className="group relative inline-block">
      <summary className="flex w-72 cursor-pointer list-none items-center justify-between gap-2 rounded-md border border-sdc-border bg-white px-3 py-2 text-sm font-medium text-sdc-navy shadow-sm hover:bg-sdc-blue-light">
        <span className="truncate">{summary}</span>
        <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 opacity-70 transition-transform duration-150 group-open:rotate-180">
          <path d="M3.5 6 L8 10.5 L12.5 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="absolute right-0 top-full z-40 mt-2 w-80 rounded-lg border border-sdc-border bg-white p-2 shadow-lg">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search job # or name…"
          className={`${INPUT} mb-2 w-full`}
          autoFocus
        />
        <div className="max-h-80 overflow-y-auto">
          {groups.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-sdc-gray-400">No jobs match.</p>
          ) : (
            groups.map((g) => {
              const open = isOpen(g.name);
              return (
                <div key={g.name}>
                  {/* Group header — a collapse toggle, not a selectable row, so
                      clicking a status can never change which job is selected. */}
                  <button
                    type="button"
                    onClick={() => setOverrides((o) => ({ ...o, [g.name]: !open }))}
                    aria-expanded={open}
                    className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-xs font-semibold text-sdc-navy hover:bg-sdc-gray-100"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      width="9"
                      height="9"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      className={`shrink-0 opacity-60 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
                    >
                      <path d="M6 3.5 L10.5 8 L6 12.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="truncate">{g.name}</span>
                    <span className="ml-auto shrink-0 pl-1 font-normal text-sdc-gray-400">{g.items.length}</span>
                  </button>
                  {open && (
                    // Indented to the group's label, with a hairline rule so a
                    // long expanded group still reads as belonging to its header
                    // once the header has scrolled off.
                    <div className="ml-2 border-l border-sdc-border-soft pl-1">
                      {g.items.map((j) => {
                        const isCurrent = j.jobId === selected;
                        return (
                          // A real <button> per row, not a checkbox label: one
                          // click picks and closes, and the row is
                          // keyboard-reachable as one control.
                          <button
                            key={j.id}
                            type="button"
                            onClick={() => pick(j.jobId)}
                            aria-current={isCurrent ? "true" : undefined}
                            className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-sdc-gray-100 ${
                              isCurrent ? "bg-sdc-blue-light font-medium text-sdc-blue-dark" : ""
                            }`}
                          >
                            {/* Fixed-width check slot so the labels line up
                                whether or not a row is the current one. */}
                            <span className="w-3 shrink-0 text-sdc-blue-dark">{isCurrent ? "✓" : ""}</span>
                            <span className="truncate">
                              <span className="font-mono text-sdc-gray-500">{j.jobId}</span> — {j.jobName}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </details>
  );
}
