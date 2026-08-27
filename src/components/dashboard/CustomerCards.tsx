"use client";

import { useState } from "react";
import Link from "next/link";
import type { CustomerSummary } from "@/lib/dashboard-overview";

// How many customer cards show before the "show all" toggle. The live book has
// ~24 distinct customer strings across ~59 active jobs, and the long tail is
// single-job customers — 8 covers everyone with more than one active job plus a
// few, which is the "prioritize customers with active work and avoid excessive
// empty cards" line the redesign draws. Nothing is hidden permanently: the
// toggle reveals the rest, and the count in the header is always the true one.
const INITIAL = 8;

// One compact card per customer: name, active count, and the type mix as inline
// chips. The chips are the mix — a nested bar chart per card would be five
// two-pixel bars nobody can compare across cards, whereas "Custom 6 · Duplicate
// 3" is read at a glance and is exactly what the section is for.
function CustomerCard({ c, activeTotal }: { c: CustomerSummary; activeTotal: number }) {
  return (
    <Link
      href={`/jobs?status=Active&customer=${encodeURIComponent(c.name)}`}
      className="flex min-w-0 flex-col justify-between gap-2 bg-white px-3.5 py-3 motion-interactive hover:bg-sdc-blue-light/25"
      title={`${c.name} — jobs ${c.jobIds.join(", ")}`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-sdc-navy">{c.name}</span>
          <span className="text-label text-sdc-gray-400">
            {activeTotal === 0 ? "—" : `${Math.round((c.activeCount / activeTotal) * 1000) / 10}% of active book`}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-heading text-2xl leading-none font-bold tabular-nums text-sdc-blue">{c.activeCount}</span>
          <span className="text-label text-sdc-gray-400">active</span>
        </span>
      </span>
      <span className="flex flex-wrap gap-1">
        {c.byType.map((t) => (
          <span key={t.type} className="rounded-md bg-sdc-gray-100 px-1.5 py-0.5 text-label font-medium text-sdc-gray-600">
            {t.type} <span className="font-bold tabular-nums text-sdc-navy">{t.count}</span>
          </span>
        ))}
        {/* SDC's own jobs are internal work, not a customer relationship —
            flagged rather than dropped, because they ARE active jobs and the
            cards have to reconcile to the Active Jobs total. */}
        {c.internal && (
          <span className="rounded-md bg-sdc-blue-light px-1.5 py-0.5 text-label font-semibold text-sdc-blue-dark">Internal</span>
        )}
      </span>
    </Link>
  );
}

export function CustomerCards({ customers, activeTotal }: { customers: CustomerSummary[]; activeTotal: number }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? customers : customers.slice(0, INITIAL);
  const hidden = customers.length - shown.length;
  const hiddenJobs = customers.slice(shown.length).reduce((s, c) => s + c.activeCount, 0);

  if (customers.length === 0) {
    return (
      <div className="rounded-xl border border-sdc-border bg-white p-5 text-sm text-sdc-gray-400 shadow-sm">
        No active jobs, so no customers to show.
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-sdc-border bg-sdc-border-soft shadow-sm sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((c) => (
          <CustomerCard key={c.name} c={c} activeTotal={activeTotal} />
        ))}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-2 text-label font-semibold text-sdc-blue underline-offset-2 hover:underline"
        >
          Show {hidden} more customer{hidden === 1 ? "" : "s"} ({hiddenJobs} active job{hiddenJobs === 1 ? "" : "s"})
        </button>
      )}
      {showAll && customers.length > INITIAL && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="mt-2 text-label font-semibold text-sdc-blue underline-offset-2 hover:underline"
        >
          Show fewer
        </button>
      )}
    </>
  );
}
