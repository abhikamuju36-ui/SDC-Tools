"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

// Single-job selector for the Job Cost (BOM) page. A searchable dropdown (there
// can be hundreds of jobs) instead of a bare native <select> — type-ahead on
// job id or name, matching the richer picker on Job Hour Details.
export function JobCostPicker({
  jobs,
  selected,
}: {
  jobs: { jobId: string; jobName: string }[];
  selected: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [q, setQ] = useState("");

  const selectedJob = jobs.find((j) => j.jobId === selected);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? jobs.filter((j) => `${j.jobId} ${j.jobName}`.toLowerCase().includes(s)) : jobs;
  }, [jobs, q]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (detailsRef.current?.open && !detailsRef.current.contains(e.target as Node)) detailsRef.current.open = false;
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const choose = (jobId: string) => {
    if (detailsRef.current) detailsRef.current.open = false;
    setQ("");
    router.push(`${pathname}?job=${encodeURIComponent(jobId)}`);
  };

  return (
    <details ref={detailsRef} className="relative inline-block">
      <summary className="flex w-72 cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-sdc-border bg-white px-3.5 py-2 text-sm text-sdc-navy shadow-sm hover:bg-sdc-blue-light">
        <span className="truncate">{selectedJob ? `${selectedJob.jobId} — ${selectedJob.jobName}` : "Select job"}</span>
        <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 opacity-70">
          <path d="M3.5 6 L8 10.5 L12.5 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div
        className="absolute left-0 top-full z-30 mt-1 w-72 rounded-lg border border-sdc-border bg-white p-1.5 shadow-lg"
        onKeyDown={(e) => {
          if (e.key === "Escape" && detailsRef.current) detailsRef.current.open = false;
        }}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search jobs…"
          aria-label="Search jobs"
          className="mb-1.5 w-full rounded-md border border-sdc-border px-2.5 py-1.5 text-sm outline-none focus:border-sdc-blue"
        />
        <div className="max-h-72 overflow-auto">
          {filtered.length === 0 ? (
            <p className="px-2 py-2 text-xs text-sdc-gray-400">No job matches “{q}”.</p>
          ) : (
            filtered.map((j) => (
              <button
                key={j.jobId}
                type="button"
                onClick={() => choose(j.jobId)}
                className={`block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-sdc-blue-light ${
                  j.jobId === selected ? "bg-sdc-blue-light font-semibold text-sdc-blue-dark" : "text-sdc-navy"
                }`}
              >
                {j.jobId} — {j.jobName}
              </button>
            ))
          )}
        </div>
      </div>
    </details>
  );
}
