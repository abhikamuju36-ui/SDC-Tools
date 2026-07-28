"use client";

import { useMemo, useState } from "react";
import type { BomNode, JobBom } from "@/lib/job-bom";
import { usd } from "@/components/ui/format";

// Spec section titles (SpecID → name), matching the Build Readiness procurement
// view. Anything else falls back to just "Spec N".
const SPEC_TITLES: Record<number, string> = {
  10: "Mechanical Design and Build",
  30: "Controls Design",
  40: "Machine Testing",
  90: "Spare Parts",
};

function num(n: number): string {
  return (Math.round(n) || 0).toLocaleString();
}

// Job Cost BOM — grouped assembly view styled after the Build Readiness
// procurement page: each Spec section lists its assemblies as rows with a
// part-number chip, name, part counts, and a bar showing that assembly's SHARE
// OF TOTAL COST (the cost analog of the readiness bar — this page has cost data,
// not PO/readiness). Assemblies expand to their nested sub-assemblies/parts.
export function JobBomMatrix({ bom }: { bom: JobBom }) {
  const [query, setQuery] = useState("");

  const allParents = useMemo(() => {
    const s = new Set<string>();
    const walk = (n: BomNode) => {
      if (n.children.length) s.add(n.key);
      n.children.forEach(walk);
    };
    bom.roots.forEach(walk);
    return s;
  }, [bom]);

  // Default: sections open (so top-level assemblies show), each assembly
  // collapsed — mirrors the reference's opening state.
  const defaultCollapsed = useMemo(() => {
    const s = new Set(allParents);
    bom.roots.forEach((r) => s.delete(r.key));
    return s;
  }, [allParents, bom.roots]);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(defaultCollapsed));
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const q = query.trim().toLowerCase();
  const matches = (n: BomNode) => !q || `${n.pn} ${n.desc} ${n.label}`.toLowerCase().includes(q);
  const grand = bom.grandTotalCost || 1;

  // Flat, depth-ordered rows for a section: respect collapse normally; while
  // searching, show every matching descendant flat (ignoring collapse).
  const rowsFor = (section: BomNode): BomNode[] => {
    const out: BomNode[] = [];
    const walkOpen = (n: BomNode) => {
      out.push(n);
      if (!collapsed.has(n.key)) n.children.forEach(walkOpen);
    };
    const walkSearch = (n: BomNode) => {
      if (matches(n)) out.push(n);
      n.children.forEach(walkSearch);
    };
    section.children.forEach(q ? walkSearch : walkOpen);
    return out;
  };

  const ghostBtn =
    "rounded-md border border-sdc-border bg-white px-2.5 py-1 text-xs font-medium text-sdc-navy hover:bg-sdc-blue-light";

  return (
    <div className="flex flex-col gap-3">
      {/* Search + summary */}
      <div className="flex items-center gap-2.5 rounded-lg border border-sdc-border bg-white px-3">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sdc-gray-400">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search parts, assemblies…"
          aria-label="Search BOM"
          className="w-full border-none bg-transparent py-2 text-sm text-sdc-navy outline-none placeholder:text-sdc-gray-400"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-sdc-gray-400 hover:text-sdc-navy">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 4 L12 12 M12 4 L4 12" strokeLinecap="round" /></svg>
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sdc-border bg-white px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-6">
          <Stat label="Total Cost" value={usd(bom.grandTotalCost)} strong />
          <Stat label="Parts" value={num(bom.grandTotalPartQty)} />
          <Stat label="Sections" value={String(bom.roots.length)} />
          <Stat label="BOM Lines" value={num(bom.rowCount)} />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setCollapsed(new Set())} className={ghostBtn}>Expand All</button>
          <button type="button" onClick={() => setCollapsed(new Set(defaultCollapsed))} className={ghostBtn}>Collapse All</button>
        </div>
      </div>

      {/* Sections */}
      <div className="max-h-[82vh] overflow-auto styled-scrollbar rounded-xl border border-sdc-border bg-white shadow-sm">
        {bom.roots.map((section) => {
          const specId = Number(section.key.slice(1));
          const title = SPEC_TITLES[specId] ?? "";
          const rows = rowsFor(section);
          if (q && rows.length === 0) return null;
          return (
            <div key={section.key}>
              <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 border-b border-sdc-border-soft bg-sdc-gray-100 px-4 py-2">
                <span className="text-[13px] font-bold text-sdc-navy">
                  Spec {specId}
                  {title ? ` — ${title}` : ""}
                </span>
                <span className="whitespace-nowrap text-xs text-sdc-gray-500">
                  {num(section.totalPartQty)} parts · {usd(section.totalCost)}
                </span>
              </div>
              {rows.map((n) => {
                const hasKids = n.children.length > 0;
                const isCollapsed = collapsed.has(n.key);
                const share = Math.round((n.totalCost / grand) * 100);
                const indent = 12 + Math.max(0, n.depth - 2) * 20;
                return (
                  <div
                    key={n.key}
                    className="flex items-center gap-3 border-b border-sdc-border-soft/50 py-2 pr-3 hover:bg-sdc-blue-light/30"
                    style={{ paddingLeft: indent }}
                  >
                    {hasKids && !q ? (
                      <button
                        type="button"
                        onClick={() => toggle(n.key)}
                        aria-label={isCollapsed ? "Expand" : "Collapse"}
                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-sdc-gray-400 hover:bg-sdc-blue-light hover:text-sdc-navy"
                      >
                        <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${isCollapsed ? "" : "rotate-90"}`}>
                          <path d="M6 3.5 L10.5 8 L6 12.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    ) : (
                      <span className="w-5 shrink-0" />
                    )}
                    <span className="shrink-0 rounded bg-sdc-blue-light px-1.5 py-0.5 font-mono text-[11px] font-semibold text-sdc-blue-dark">
                      {n.pn || "—"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-sdc-navy" title={n.desc || n.label}>
                        {n.desc || n.label || "—"}
                      </div>
                      <div className="text-[11px] text-sdc-gray-500">
                        {num(n.totalPartQty)} parts
                        {n.nestedAssemblies ? ` · ${n.nestedAssemblies} sub-assy` : ""}
                      </div>
                    </div>
                    <div className="flex w-40 shrink-0 items-center gap-2" title={`${share}% of total job cost`}>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sdc-gray-100">
                        <div
                          className={`h-full rounded-full ${share >= 20 ? "bg-sdc-blue" : "bg-sdc-blue-100"}`}
                          style={{ width: `${Math.min(100, share)}%` }}
                        />
                      </div>
                      <span className="w-9 text-right text-[11px] font-semibold tabular-nums text-sdc-gray-600">{share}%</span>
                    </div>
                    <span className="w-24 shrink-0 text-right text-[13px] font-medium tabular-nums text-sdc-navy">
                      {n.totalCost ? usd(n.totalCost) : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
        {q && bom.roots.every((s) => rowsFor(s).length === 0) && (
          <p className="px-4 py-8 text-center text-sm text-sdc-gray-400">No parts or assemblies match “{query}”.</p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] font-bold uppercase tracking-wider text-sdc-gray-400">{label}</span>
      <span className={`tabular-nums ${strong ? "text-sm font-bold text-sdc-navy" : "text-[13px] font-semibold text-sdc-gray-700"}`}>{value}</span>
    </div>
  );
}
