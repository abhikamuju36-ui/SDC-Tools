"use client";

import { useMemo, useState } from "react";
import type { BomNode, BomPart, JobBom } from "@/lib/job-bom";
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

// Compact date — "Dec 14". Formats a passed ISO string only (no module-level
// `new Date()`, so SSR stays deterministic). Returns "—" for empty/invalid.
function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Supplier chip — colored 2-letter initial (deterministic hash palette, ported
// from the reference VendorAvatar so the same supplier keeps the same color).
const AVATAR_PALETTE = [
  "#3182CE", "#429C5D", "#805AD5", "#DD6B20", "#D44A4A",
  "#2B8A8A", "#C05621", "#6B46C1", "#2F855A", "#C53030",
  "#2C7A7B", "#744210", "#553C9A", "#276749", "#9B2C2C",
  "#2A69AC", "#B7791F", "#4A5568", "#285E61", "#702459",
];

function avatarColor(name: string): string {
  const hash = name.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function SupplierChip({ supplier }: { supplier: string | null }) {
  if (!supplier) return <span className="text-[11px] text-sdc-gray-400">—</span>;
  const initials = supplier
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden
        className="inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded text-[7px] font-bold text-white"
        style={{ background: avatarColor(supplier) }}
      >
        {initials}
      </span>
      <span className="truncate text-[11px] text-sdc-gray-600" title={supplier}>
        {supplier}
      </span>
    </span>
  );
}

function StatusBadge({ status }: { status: BomPart["status"] }) {
  const map = {
    received: { cls: "bg-sdc-green-bg text-sdc-green-text", label: "RCVD" },
    ordered: { cls: "bg-sdc-blue-light text-sdc-blue-dark", label: "ORDERED" },
    noPO: { cls: "bg-sdc-red-bg text-sdc-red-text", label: "NO PO" },
  } as const;
  const m = map[status];
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${m.cls}`}
    >
      {m.label}
    </span>
  );
}

// Readiness bar color: green at 100, amber >= 60, red below.
function barClasses(pct: number): { bar: string; text: string } {
  if (pct >= 100) return { bar: "bg-sdc-green", text: "text-sdc-green-text" };
  if (pct >= 60) return { bar: "bg-sdc-yellow", text: "text-sdc-yellow-text" };
  return { bar: "bg-sdc-red", text: "text-sdc-red-text" };
}

// Job Cost BOM — grouped procurement view styled after the Build Readiness
// page: each Spec section lists its assemblies as expandable rows with a
// part-number chip, name, part counts, and a readiness % bar. Expanding an
// assembly reveals its direct leaf parts as a detail table (status badges,
// supplier chip, dates); sub-assemblies nest recursively.
export function JobBomMatrix({ bom }: { bom: JobBom }) {
  const [query, setQuery] = useState("");

  // Every assembly key (across all sections) — used for Expand/Collapse All.
  const allAssemblyKeys = useMemo(() => {
    const s = new Set<string>();
    const walk = (n: BomNode) => {
      if (n.children.length) s.add(n.key);
      n.children.forEach(walk);
    };
    bom.roots.forEach((section) => section.children.forEach(walk));
    return s;
  }, [bom]);

  // Assemblies start expanded (their part tables visible) — matches the
  // reference's opening behaviour where a spec's assemblies auto-open.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const q = query.trim().toLowerCase();
  const partMatches = (p: BomPart) =>
    !q || `${p.pn} ${p.desc} ${p.manufacturer} ${p.supplier ?? ""}`.toLowerCase().includes(q);
  const nodeMatches = (n: BomNode): boolean => {
    if (!q) return true;
    if (`${n.pn} ${n.desc} ${n.label}`.toLowerCase().includes(q)) return true;
    if (n.parts.some(partMatches)) return true;
    return n.children.some(nodeMatches);
  };

  const ghostBtn =
    "rounded-md border border-sdc-border bg-white px-2.5 py-1 text-xs font-medium text-sdc-navy hover:bg-sdc-blue-light";

  return (
    <div className="flex flex-col gap-3">
      {/* Search */}
      <div className="flex items-center gap-2.5 rounded-lg border border-sdc-border bg-white px-3">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sdc-gray-400">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search parts, assemblies, suppliers…"
          aria-label="Search BOM"
          className="w-full border-none bg-transparent py-2 text-sm text-sdc-navy outline-none placeholder:text-sdc-gray-400"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-sdc-gray-400 hover:text-sdc-navy">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 4 L12 12 M12 4 L4 12" strokeLinecap="round" /></svg>
          </button>
        )}
      </div>

      {/* Summary + expand controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sdc-border bg-white px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-6">
          <Stat label="Total Cost" value={usd(bom.grandTotalCost)} strong />
          <Stat label="Parts" value={num(bom.grandTotalPartQty)} />
          <Stat label="Sections" value={String(bom.roots.length)} />
          <Stat label="BOM Lines" value={num(bom.rowCount)} />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setCollapsed(new Set())} className={ghostBtn}>Expand All</button>
          <button type="button" onClick={() => setCollapsed(new Set(allAssemblyKeys))} className={ghostBtn}>Collapse All</button>
        </div>
      </div>

      {/* Sections */}
      <div className="max-h-[82vh] overflow-auto styled-scrollbar rounded-xl border border-sdc-border bg-white shadow-sm">
        {bom.roots.map((section) => {
          const specId = typeof section.id === "string" ? Number(section.id.slice(1)) : section.id;
          const title = SPEC_TITLES[specId] ?? section.desc ?? "";
          const visibleAssemblies = q ? section.children.filter(nodeMatches) : section.children;
          const visibleLooseParts = section.parts.filter(partMatches);
          if (q && visibleAssemblies.length === 0 && visibleLooseParts.length === 0) return null;
          return (
            <div key={section.key}>
              <div className="sticky top-0 z-[2] flex items-center justify-between gap-2 border-b border-sdc-border-soft bg-sdc-gray-100 px-4 py-2">
                <span className="text-[13px] font-bold text-sdc-navy">
                  Spec {specId}
                  {title ? ` — ${title}` : ""}
                </span>
                <span className="whitespace-nowrap text-xs text-sdc-gray-600">
                  {section.stats.received}/{section.stats.total} parts · {section.stats.pct}% ready · {usd(section.totalCost)}
                </span>
              </div>
              {visibleAssemblies.map((asm) => (
                <AssemblyRow
                  key={asm.key}
                  node={asm}
                  depth={0}
                  collapsed={collapsed}
                  toggle={toggle}
                  q={q}
                  partMatches={partMatches}
                  nodeMatches={nodeMatches}
                />
              ))}
              {visibleLooseParts.length > 0 && (
                <PartsTable parts={visibleLooseParts} depth={0} />
              )}
            </div>
          );
        })}
        {q && bom.roots.every((s) => !nodeMatches(s) && !s.parts.some(partMatches)) && (
          <p className="px-4 py-8 text-center text-sm text-sdc-gray-400">No parts or assemblies match “{query}”.</p>
        )}
      </div>
    </div>
  );
}

function AssemblyRow({
  node,
  depth,
  collapsed,
  toggle,
  q,
  partMatches,
  nodeMatches,
}: {
  node: BomNode;
  depth: number;
  collapsed: Set<string>;
  toggle: (key: string) => void;
  q: string;
  partMatches: (p: BomPart) => boolean;
  nodeMatches: (n: BomNode) => boolean;
}) {
  // While searching, force-open everything so matches are visible.
  const isOpen = q ? true : !collapsed.has(node.key);
  const { bar, text } = barClasses(node.stats.pct);
  const visibleParts = node.parts.filter(partMatches);
  const visibleChildren = q ? node.children.filter(nodeMatches) : node.children;

  return (
    <div className="border-b border-sdc-border-soft/60">
      {/* Assembly header — whole row toggles */}
      <div
        onClick={q ? undefined : () => toggle(node.key)}
        className={`flex items-stretch hover:bg-sdc-blue-light/30 ${q ? "" : "cursor-pointer"}`}
      >
        {/* Hierarchy guide rails — one vertical line per ancestor level. */}
        {Array.from({ length: depth }).map((_, i) => (
          <span key={i} aria-hidden className="w-5 shrink-0 border-l border-sdc-border-soft" />
        ))}
        <div className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-2 pr-3">
          <span
            aria-label={isOpen ? "Collapse" : "Expand"}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-sdc-blue hover:bg-sdc-blue-light"
          >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" className={`transition-transform ${isOpen ? "rotate-90" : ""}`}>
              <path d="M6 3.5 L10.5 8 L6 12.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="shrink-0 rounded bg-sdc-blue px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">
            {node.pn || "—"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-bold text-sdc-navy" title={node.desc || node.label}>
              {node.desc || node.label || "—"}
            </div>
            <div className="text-[11px] text-sdc-gray-600">
              <span className={`font-semibold ${text}`}>
                {node.stats.received}/{node.stats.total} parts
              </span>
              {node.children.length ? ` · ${node.children.length} sub-assy` : ""}
              {node.stats.noPO ? ` · ${node.stats.noPO} no PO` : ""}
              {node.totalCost ? ` · ${usd(node.totalCost)}` : ""}
            </div>
          </div>
          {/* Readiness bar + % */}
          <div className="flex w-40 shrink-0 items-center gap-2" title={`${node.stats.pct}% ready`}>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sdc-gray-100">
              <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, node.stats.pct)}%` }} />
            </div>
            <span className={`w-9 text-right text-[11px] font-semibold tabular-nums ${text}`}>{node.stats.pct}%</span>
          </div>
        </div>
      </div>

      {isOpen && (
        <div>
          {/* Sub-assemblies first (nested). */}
          {visibleChildren.map((child) => (
            <AssemblyRow
              key={child.key}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              toggle={toggle}
              q={q}
              partMatches={partMatches}
              nodeMatches={nodeMatches}
            />
          ))}
          {/* Direct leaf parts as a detail table. */}
          {visibleParts.length > 0 && <PartsTable parts={visibleParts} depth={depth + 1} />}
        </div>
      )}
    </div>
  );
}

function PartsTable({ parts, depth }: { parts: BomPart[]; depth: number }) {
  return (
    <div className="flex items-stretch bg-sdc-gray-50/60">
      {Array.from({ length: depth }).map((_, i) => (
        <span key={i} aria-hidden className="w-5 shrink-0 border-l border-sdc-border-soft" />
      ))}
      <div className="min-w-0 flex-1 overflow-x-auto styled-scrollbar">
        <table className="w-full min-w-[860px] border-collapse text-left">
          <thead>
            <tr className="bg-sdc-navy text-[9px] font-bold uppercase tracking-wider text-white">
              <th className="px-2 py-1.5 font-bold">Status</th>
              <th className="px-2 py-1.5 text-right font-bold">Qty</th>
              <th className="px-2 py-1.5 font-bold">Part #</th>
              <th className="px-2 py-1.5 font-bold">Description</th>
              <th className="px-2 py-1.5 font-bold">Manufacturer</th>
              <th className="px-2 py-1.5 font-bold">Supplier</th>
              <th className="px-2 py-1.5 font-bold">Req Date</th>
              <th className="px-2 py-1.5 font-bold">Expected</th>
              <th className="px-2 py-1.5 font-bold">Rcvd Date</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p, i) => (
              <tr key={`${p.id}-${i}`} className="border-b border-sdc-border-soft/60 hover:bg-sdc-blue-light/25">
                <td className="px-2 py-1.5"><StatusBadge status={p.status} /></td>
                <td className="px-2 py-1.5 text-right text-[11px] font-semibold tabular-nums text-sdc-gray-600">{num(p.qty)}</td>
                <td className="px-2 py-1.5">
                  <span className="font-mono text-[11px] font-semibold text-sdc-blue">{p.pn}</span>
                </td>
                <td className="px-2 py-1.5 text-[11px] text-sdc-navy" title={p.desc}>
                  <span className="line-clamp-1">{p.desc || "—"}</span>
                </td>
                <td className="px-2 py-1.5 text-[11px] text-sdc-gray-600" title={p.manufacturer}>
                  <span className="line-clamp-1">
                    {p.manufacturer === "SDC" ? "In-house (SDC)" : p.manufacturer || "—"}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-[11px] text-sdc-gray-600">
                  <SupplierChip supplier={p.supplier} />
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap font-mono text-[10px] text-sdc-gray-600">{fmtDate(p.requiredDate)}</td>
                <td className="px-2 py-1.5 whitespace-nowrap font-mono text-[10px] text-sdc-gray-600">{fmtDate(p.expectedDate)}</td>
                <td className={`px-2 py-1.5 whitespace-nowrap font-mono text-[10px] ${p.receivedDate ? "text-sdc-green-text" : "text-sdc-gray-400"}`}>{fmtDate(p.receivedDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] font-bold uppercase tracking-wider text-sdc-gray-400">{label}</span>
      <span className={`tabular-nums ${strong ? "text-sm font-bold text-sdc-navy" : "text-[13px] font-semibold text-sdc-gray-600"}`}>{value}</span>
    </div>
  );
}
