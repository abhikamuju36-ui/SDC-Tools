"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BomNode, BomPart, JobBom } from "@/lib/job-bom";
import type { PartsCostLine } from "@/lib/sync-totaleto";
import { usd } from "@/components/ui/format";
import { useToast } from "@/components/ui/Toast";

// A minimal shape shared by BOM leaf parts (Assemblies detail table) and the
// flattened Parts List rows — enough to drill + copy.
type DrillablePart = { id: number; pn: string };

// ─────────────────────────────────────────────────────────────────────────────
// Procurement drawer — the Build Readiness "Procurement" view, ported to the
// ETC app's design tokens. Two tabs:
//   • Assemblies — the Spec-grouped readiness tree (RCVD·TOTAL / NO PO / PRICED /
//     MATERIAL $ / READINESS %) with a section subtotal per group and a dark
//     "BOM materials value" footer.
//   • Parts List — every BOM leaf part flattened (so no-PO parts appear too),
//     joined to the live PO purchase lines by part number for category /
//     purchased / invoiced / PO#, plus the Delivery-Slip + No-PO summary cards.
// Pure/SSR-safe at module scope; every `new Date()` lives inside a handler or
// useMemo (this is a client component).
// ─────────────────────────────────────────────────────────────────────────────

const SPEC_TITLES: Record<number, string> = {
  10: "Mechanical Design and Build",
  30: "Controls Design",
  40: "Machine Testing",
  90: "Spare Parts",
};

const DAY = 86_400_000;

function num(n: number): string {
  return (Math.round(n) || 0).toLocaleString();
}

// Compact date — "Dec 14". Formats a passed ISO string only. "—" for empty/bad.
function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Normalize a part number for join/dedupe — trim, collapse whitespace, upper.
function normPn(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

// Days between two ISO dates (b − a), or null if either is missing/invalid.
function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.round((db - da) / DAY);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared visual atoms (supplier chip / status badge / readiness bar)
// ─────────────────────────────────────────────────────────────────────────────

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
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${m.cls}`}>
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

function ReadinessBar({ pct, width = "w-full" }: { pct: number; width?: string }) {
  const { bar, text } = barClasses(pct);
  return (
    <div className={`flex items-center gap-2 ${width}`} title={`${pct}% ready`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sdc-gray-100">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <span className={`w-9 shrink-0 text-right text-[11px] font-semibold tabular-nums ${text}`}>{pct}%</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Flatten + join
// ─────────────────────────────────────────────────────────────────────────────

// A BOM leaf part enriched with its parent assembly + the joined PO purchase
// line (category / purchased / invoiced / PO#) and derived lead/due.
type FlatPart = BomPart & {
  parentPN: string;
  parentDesc: string;
  sectionId: string;
  sectionLabel: string;
  category: string | null;
  purchasedDate: string | null;
  invoicedDate: string | null;
  poNumber: string | null;
  leadDays: number | null;
};

function sectionLabelFor(section: BomNode): string {
  const specId = typeof section.id === "string" ? Number(section.id.replace(/\D/g, "")) : Number(section.id);
  const title = SPEC_TITLES[specId] ?? section.desc ?? "";
  return `Spec ${specId}${title ? ` — ${title}` : ""}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function JobProcurement({ bom, partsLines }: { bom: JobBom; partsLines: PartsCostLine[] }) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"assemblies" | "parts">("assemblies");

  // Parts List filter/view state lives here (not in PartsListTab) so a drill
  // from the Assemblies tab can reset every filter + force table mode before
  // the Parts List even mounts, guaranteeing the target row renders.
  const [view, setView] = useState<"list" | "card">("list");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | BomPart["status"]>("all");
  const [category, setCategory] = useState("all");
  const [manufacturer, setManufacturer] = useState("all");
  const [supplier, setSupplier] = useState("all");
  const [dateType, setDateType] = useState<"purchase" | "invoice">("purchase");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Drill target — key = String(part.id). `nonce` bumps on every drill so the
  // Parts List effect re-fires even when the same row is targeted twice.
  const [drill, setDrill] = useState<{ key: string; nonce: number }>({ key: "", nonce: 0 });

  // The primary click action anywhere a part is shown: jump to its Parts-List
  // row (table mode, filters cleared, then scroll+flash) and copy the part #.
  const drillToPart = useCallback(
    (p: DrillablePart) => {
      setStatus("all");
      setCategory("all");
      setManufacturer("all");
      setSupplier("all");
      setQuery("");
      setFrom("");
      setTo("");
      setDateType("purchase");
      setView("list");
      setTab("parts");
      setDrill((d) => ({ key: String(p.id), nonce: d.nonce + 1 }));
      if (p.pn && p.pn !== "—") {
        navigator.clipboard?.writeText(p.pn).then(() => toast(`Copied ${p.pn}`, "success")).catch(() => {});
      }
    },
    [toast],
  );

  const partsState = { view, setView, query, setQuery, status, setStatus, category, setCategory, manufacturer, setManufacturer, supplier, setSupplier, dateType, setDateType, from, setFrom, to, setTo } as const;

  // PO purchase lines indexed by normalized part number, newest purchase first.
  const lineIndex = useMemo(() => {
    const m = new Map<string, PartsCostLine[]>();
    for (const l of partsLines ?? []) {
      const key = normPn(l.partNumber);
      if (!key) continue;
      const arr = m.get(key);
      if (arr) arr.push(l);
      else m.set(key, [l]);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => (b.purchaseDate ?? "").localeCompare(a.purchaseDate ?? ""));
    }
    return m;
  }, [partsLines]);

  // Every BOM leaf part flattened + enriched + deduped by part id, so this is a
  // true procurement buy-list (each physical part once) — the source for the
  // Parts List table, the two summary cards, and the top readiness line.
  const parts = useMemo<FlatPart[]>(() => {
    const out: FlatPart[] = [];
    const seen = new Set<number>();

    const enrich = (p: BomPart, parentPN: string, parentDesc: string, sectionId: string, sectionLabel: string) => {
      if (seen.has(p.id)) return;
      seen.add(p.id);
      const line = lineIndex.get(normPn(p.pn))?.[0] ?? null;
      out.push({
        ...p,
        parentPN,
        parentDesc,
        sectionId,
        sectionLabel,
        category: line?.category ?? null,
        purchasedDate: line?.purchaseDate ?? null,
        invoicedDate: line?.invoicedDate ?? null,
        poNumber: p.poId ?? line?.poNumber ?? null,
        supplier: p.supplier ?? line?.supplier ?? null,
        leadDays: daysBetween(line?.purchaseDate ?? null, p.expectedDate),
      });
    };

    const walk = (node: BomNode, sectionId: string, sectionLabel: string) => {
      for (const p of node.parts) enrich(p, node.pn, node.desc, sectionId, sectionLabel);
      for (const c of node.children) walk(c, sectionId, sectionLabel);
    };

    for (const section of bom.roots) {
      const sectionId = String(section.id);
      const sectionLabel = sectionLabelFor(section);
      // Loose parts directly under the section have no parent assembly.
      for (const p of section.parts) enrich(p, "", "", sectionId, sectionLabel);
      for (const c of section.children) walk(c, sectionId, sectionLabel);
    }
    return out;
  }, [bom, lineIndex]);

  // Top summary line.
  const summary = useMemo(() => {
    const total = parts.length;
    const received = parts.filter((p) => p.status === "received").length;
    const noPO = parts.filter((p) => p.status === "noPO").length;
    const pct = total ? Math.round((received / total) * 100) : 0;
    return { total, received, noPO, pct };
  }, [parts]);

  const assembliesCount = useMemo(
    () => bom.roots.reduce((s, sec) => s + sec.nestedAssemblies, 0),
    [bom],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Top readiness summary line */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-sdc-border bg-white px-4 py-3 shadow-sm">
        <span className="text-[9px] font-bold uppercase tracking-wider text-sdc-gray-400">Readiness</span>
        <div className="w-40">
          <ReadinessBar pct={summary.pct} />
        </div>
        <span className="text-sm text-sdc-gray-600">
          <span className="font-semibold text-sdc-navy tabular-nums">{num(summary.total)}</span> parts
          {" · "}
          <span className={summary.noPO ? "font-semibold text-sdc-red-text tabular-nums" : "tabular-nums"}>
            {num(summary.noPO)}
          </span>{" "}
          no PO
          {" · "}
          <span className="font-semibold text-sdc-navy tabular-nums">{usd(bom.grandTotalCost)}</span> materials
        </span>
      </div>

      {/* Tab chips */}
      <div className="flex items-center gap-2">
        <TabChip active={tab === "assemblies"} onClick={() => setTab("assemblies")} label="Assemblies" count={assembliesCount} />
        <TabChip active={tab === "parts"} onClick={() => setTab("parts")} label="Parts List" count={parts.length} />
      </div>

      {tab === "assemblies" ? (
        <AssembliesTab bom={bom} onPartClick={drillToPart} />
      ) : (
        <PartsListTab parts={parts} state={partsState} drill={drill} onPartClick={drillToPart} />
      )}
    </div>
  );
}

function TabChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg border px-3.5 h-9 text-sm font-semibold transition-colors ${
        active
          ? "border-sdc-blue bg-sdc-blue-light text-sdc-blue-dark"
          : "border-sdc-border bg-white text-sdc-gray-600 hover:bg-sdc-blue-light"
      }`}
    >
      {label}
      <span
        className={`inline-flex min-w-[1.5rem] items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
          active ? "bg-white/70 text-sdc-blue-dark" : "bg-sdc-gray-100 text-sdc-gray-600"
        }`}
      >
        {num(count)}
      </span>
    </button>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Assemblies tab
// ═════════════════════════════════════════════════════════════════════════════

// Grid template shared by the dark header + every assembly row so columns align.
const ASM_GRID = "minmax(220px,1.5fr) minmax(150px,1.4fr) 92px 64px 82px 108px 150px";

function AssembliesTab({ bom, onPartClick }: { bom: JobBom; onPartClick: (p: DrillablePart) => void }) {
  // Every assembly node key — for Expand/Collapse All + collapsed-by-default.
  const { pricedByKey, allKeys } = useMemo(() => {
    const priced = new Map<string, { priced: number; total: number }>();
    const keys = new Set<string>();
    const leavesOf = (node: BomNode): BomPart[] => {
      const byId = new Map<number, BomPart>();
      const walk = (n: BomNode) => {
        for (const p of n.parts) if (!byId.has(p.id)) byId.set(p.id, p);
        for (const c of n.children) walk(c);
      };
      walk(node);
      return [...byId.values()];
    };
    const visit = (n: BomNode) => {
      keys.add(n.key);
      const leaves = leavesOf(n);
      priced.set(n.key, { priced: leaves.filter((p) => p.unitPrice > 0).length, total: leaves.length });
      n.children.forEach(visit);
    };
    bom.roots.forEach((sec) => sec.children.forEach(visit));
    return { pricedByKey: priced, allKeys: keys };
  }, [bom]);

  // Collapsed-by-default: start with every assembly collapsed.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(allKeys));
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const ghostBtn =
    "rounded-md border border-sdc-border bg-white px-2.5 py-1 text-xs font-medium text-sdc-navy hover:bg-sdc-blue-light";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setCollapsed(new Set())} className={ghostBtn}>Expand All</button>
        <button type="button" onClick={() => setCollapsed(new Set(allKeys))} className={ghostBtn}>Collapse All</button>
      </div>

      <div className="overflow-x-auto styled-scrollbar rounded-xl border border-sdc-border bg-white shadow-sm">
        <div className="min-w-[846px]">
          {/* Dark header row */}
          <div
            className="grid items-center gap-3 bg-sdc-navy px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-white"
            style={{ gridTemplateColumns: ASM_GRID }}
          >
            <span>Assembly</span>
            <span>Description</span>
            <span className="text-right">Rcvd · Total</span>
            <span className="text-right">No PO</span>
            <span className="text-right">Priced</span>
            <span className="text-right">Material $</span>
            <span>Readiness %</span>
          </div>

          <div className="max-h-[78vh] overflow-y-auto styled-scrollbar">
            {bom.roots.map((section) => (
              <div key={section.key}>
                {/* Light section header with material-$ subtotal on the right */}
                <div className="flex items-center justify-between gap-2 border-y border-sdc-border-soft bg-sdc-gray-100 px-4 py-2">
                  <span className="text-[13px] font-bold text-sdc-navy">{sectionLabelFor(section)}</span>
                  <span className="whitespace-nowrap text-xs font-semibold text-sdc-gray-600 tabular-nums">
                    {usd(section.totalCost)}
                  </span>
                </div>

                {section.children.map((asm) => (
                  <AssemblyRow key={asm.key} node={asm} depth={0} collapsed={collapsed} toggle={toggle} pricedByKey={pricedByKey} onPartClick={onPartClick} />
                ))}
                {section.parts.length > 0 && <PartsDetailTable parts={section.parts} depth={0} onPartClick={onPartClick} />}
              </div>
            ))}

            {bom.roots.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-sdc-gray-400">No assemblies found for this job.</p>
            )}
          </div>

          {/* Dark BOM-materials footer */}
          <div className="flex items-center justify-between gap-2 bg-sdc-navy px-4 py-2.5 text-white">
            <span className="text-[11px] font-semibold uppercase tracking-wide">
              BOM materials value
              <span className="ml-2 font-normal normal-case text-white/60">assembly parts at latest PO price</span>
            </span>
            <span className="text-sm font-bold tabular-nums">{usd(bom.grandTotalCost)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AssemblyRow({
  node,
  depth,
  collapsed,
  toggle,
  pricedByKey,
  onPartClick,
}: {
  node: BomNode;
  depth: number;
  collapsed: Set<string>;
  toggle: (key: string) => void;
  pricedByKey: Map<string, { priced: number; total: number }>;
  onPartClick: (p: DrillablePart) => void;
}) {
  const isOpen = !collapsed.has(node.key);
  const { text } = barClasses(node.stats.pct);
  const priced = pricedByKey.get(node.key) ?? { priced: 0, total: node.stats.total };

  return (
    <div className="border-b border-sdc-border-soft/60">
      <div
        onClick={() => toggle(node.key)}
        className="grid cursor-pointer items-center gap-3 py-2 pr-3 hover:bg-sdc-blue-light/30"
        style={{ gridTemplateColumns: ASM_GRID }}
      >
        {/* Assembly (caret + indent + pn chip) */}
        <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${8 + depth * 18}px` }}>
          <span aria-label={isOpen ? "Collapse" : "Expand"} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-sdc-blue">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" className={`transition-transform ${isOpen ? "rotate-90" : ""}`}>
              <path d="M6 3.5 L10.5 8 L6 12.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="shrink-0 truncate rounded bg-sdc-blue px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white" title={node.pn}>
            {node.pn || "—"}
          </span>
        </div>
        {/* Description */}
        <div className="min-w-0 truncate text-[12px] font-medium text-sdc-navy" title={node.desc || node.label}>
          {node.desc || node.label || "—"}
          {node.children.length ? <span className="ml-1 text-[10px] font-normal text-sdc-gray-400">· {node.children.length} sub-assy</span> : null}
        </div>
        {/* Rcvd · Total */}
        <span className="text-right text-[11px] font-semibold tabular-nums text-sdc-gray-600">
          <span className={text}>{node.stats.received}</span> · {node.stats.total}
        </span>
        {/* No PO */}
        <span className={`text-right text-[11px] font-semibold tabular-nums ${node.stats.noPO ? "text-sdc-red-text" : "text-sdc-gray-400"}`}>
          {node.stats.noPO || "—"}
        </span>
        {/* Priced */}
        <span className="text-right text-[11px] tabular-nums text-sdc-gray-600">
          {priced.priced}/{priced.total}
        </span>
        {/* Material $ */}
        <span className="text-right text-[11px] font-semibold tabular-nums text-sdc-navy">
          {node.totalCost ? usd(node.totalCost) : "—"}
        </span>
        {/* Readiness */}
        <ReadinessBar pct={node.stats.pct} />
      </div>

      {isOpen && (
        <div>
          {node.children.map((child) => (
            <AssemblyRow key={child.key} node={child} depth={depth + 1} collapsed={collapsed} toggle={toggle} pricedByKey={pricedByKey} onPartClick={onPartClick} />
          ))}
          {node.parts.length > 0 && <PartsDetailTable parts={node.parts} depth={depth + 1} onPartClick={onPartClick} />}
        </div>
      )}
    </div>
  );
}

function PartsDetailTable({ parts, depth, onPartClick }: { parts: BomPart[]; depth: number; onPartClick: (p: DrillablePart) => void }) {
  return (
    <div className="bg-sdc-gray-50/60" style={{ paddingLeft: `${depth * 18}px` }}>
      <div className="overflow-x-auto styled-scrollbar">
        <table className="w-full min-w-[820px] border-collapse text-left">
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
              <tr
                key={`${p.id}-${i}`}
                onClick={() => onPartClick(p)}
                title="Open in Parts List · copies part #"
                className="cursor-pointer border-b border-sdc-border-soft/60 hover:bg-sdc-blue-light/25"
              >
                <td className="px-2 py-1.5"><StatusBadge status={p.status} /></td>
                <td className="px-2 py-1.5 text-right text-[11px] font-semibold tabular-nums text-sdc-gray-600">{num(p.qty)}</td>
                <td className="px-2 py-1.5">
                  <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-sdc-blue">
                    {p.pn}
                    <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.6" className="shrink-0 text-sdc-gray-400" aria-hidden>
                      <rect x="5" y="5" width="8" height="8" rx="1.5" /><path d="M3 11 V3 a1 1 0 0 1 1-1 h7" strokeLinecap="round" />
                    </svg>
                  </span>
                </td>
                <td className="px-2 py-1.5 text-[11px] text-sdc-navy" title={p.desc}><span className="line-clamp-1">{p.desc || "—"}</span></td>
                <td className="px-2 py-1.5 text-[11px] text-sdc-gray-600" title={p.manufacturer}>
                  <span className="line-clamp-1">{p.manufacturer === "SDC" ? "In-house (SDC)" : p.manufacturer || "—"}</span>
                </td>
                <td className="px-2 py-1.5 text-[11px] text-sdc-gray-600"><SupplierChip supplier={p.supplier} /></td>
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

// ═════════════════════════════════════════════════════════════════════════════
// Parts List tab
// ═════════════════════════════════════════════════════════════════════════════

type ColKey = "qty" | "pn" | "desc" | "parent" | "category" | "mfr" | "supplier" | "po" | "purchased" | "exp" | "lead" | "due" | "status";

const ALL_COLS: { key: ColKey; label: string; align?: "right" }[] = [
  { key: "qty", label: "Qty", align: "right" },
  { key: "pn", label: "Part No" },
  { key: "desc", label: "Description" },
  { key: "parent", label: "Parent Assembly" },
  { key: "category", label: "Category" },
  { key: "mfr", label: "Mfr" },
  { key: "supplier", label: "Supplier" },
  { key: "po", label: "PO #" },
  { key: "purchased", label: "Purchased" },
  { key: "exp", label: "Exp" },
  { key: "lead", label: "Lead" },
  { key: "due", label: "Due" },
  { key: "status", label: "Status" },
];

type PartsListState = {
  view: "list" | "card";
  setView: (v: "list" | "card") => void;
  query: string;
  setQuery: (v: string) => void;
  status: "all" | BomPart["status"];
  setStatus: (v: "all" | BomPart["status"]) => void;
  category: string;
  setCategory: (v: string) => void;
  manufacturer: string;
  setManufacturer: (v: string) => void;
  supplier: string;
  setSupplier: (v: string) => void;
  dateType: "purchase" | "invoice";
  setDateType: (v: "purchase" | "invoice") => void;
  from: string;
  setFrom: (v: string) => void;
  to: string;
  setTo: (v: string) => void;
};

function PartsListTab({
  parts,
  state,
  drill,
  onPartClick,
}: {
  parts: FlatPart[];
  state: PartsListState;
  drill: { key: string; nonce: number };
  onPartClick: (p: DrillablePart) => void;
}) {
  const { view, setView, query, setQuery, status, setStatus, category, setCategory, manufacturer, setManufacturer, supplier, setSupplier, dateType, setDateType, from, setFrom, to, setTo } = state;
  const [hidden, setHidden] = useState<Set<ColKey>>(() => new Set());

  // Drill effect — after a short delay, scroll the matching row into center and
  // flash it. Keyed on `nonce` so re-drilling the same part re-fires. Uses the
  // sdc-yellow-bg token for the flash (removed after ~1.8s).
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!drill.key) return;
    const t = window.setTimeout(() => {
      const el = rootRef.current?.querySelector<HTMLElement>(`[data-part-key="${drill.key}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.style.transition = "background-color 0.25s ease";
      el.style.backgroundColor = "var(--sdc-yellow-bg)";
      window.setTimeout(() => {
        el.style.backgroundColor = "";
      }, 1800);
    }, 200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drill.nonce]);

  const distinct = useMemo(() => {
    const cats = new Set<string>();
    const mfrs = new Set<string>();
    const sups = new Set<string>();
    for (const p of parts) {
      if (p.category) cats.add(p.category);
      if (p.manufacturer) mfrs.add(p.manufacturer);
      if (p.supplier) sups.add(p.supplier);
    }
    const sort = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
    return { cats: sort(cats), mfrs: sort(mfrs), sups: sort(sups) };
  }, [parts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return parts.filter((p) => {
      if (status !== "all" && p.status !== status) return false;
      if (category !== "all" && p.category !== category) return false;
      if (manufacturer !== "all" && p.manufacturer !== manufacturer) return false;
      if (supplier !== "all" && p.supplier !== supplier) return false;
      if (from || to) {
        const d = dateType === "purchase" ? p.purchasedDate : p.invoicedDate;
        if (!d) return false;
        const day = d.slice(0, 10);
        if (from && day < from) return false;
        if (to && day > to) return false;
      }
      if (q) {
        const hay = `${p.pn} ${p.desc} ${p.manufacturer} ${p.supplier ?? ""} ${p.parentPN} ${p.parentDesc} ${p.poNumber ?? ""} ${p.category ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [parts, status, category, manufacturer, supplier, from, to, dateType, query]);

  const visibleCols = ALL_COLS.filter((c) => !hidden.has(c.key));

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      <RiskCards parts={parts} onPartClick={onPartClick} />

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sdc-border bg-white px-3 py-2.5 shadow-sm">
        {/* List / Card */}
        <Segmented
          value={view}
          onChange={(v) => setView(v as "list" | "card")}
          options={[{ value: "list", label: "List" }, { value: "card", label: "Card" }]}
        />
        {/* Columns toggle */}
        <details className="relative">
          <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-sdc-border bg-white px-3 text-xs font-medium text-sdc-navy hover:bg-sdc-blue-light">
            Columns
            <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6 L8 11 L13 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </summary>
          <div className="absolute left-0 z-20 mt-1 max-h-72 w-48 overflow-auto styled-scrollbar rounded-lg border border-sdc-border bg-white p-1.5 shadow-lg">
            {ALL_COLS.map((c) => (
              <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-sdc-navy hover:bg-sdc-blue-light">
                <input
                  type="checkbox"
                  checked={!hidden.has(c.key)}
                  onChange={() =>
                    setHidden((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.key)) next.delete(c.key);
                      else next.add(c.key);
                      return next;
                    })
                  }
                />
                {c.label}
              </label>
            ))}
          </div>
        </details>

        <span className="mx-1 h-5 w-px bg-sdc-border" aria-hidden />

        <FilterSelect label="Status" value={status} onChange={(v) => setStatus(v as typeof status)} options={[
          { value: "all", label: "All status" },
          { value: "received", label: "Received" },
          { value: "ordered", label: "Ordered" },
          { value: "noPO", label: "No PO" },
        ]} />
        <FilterSelect label="Category" value={category} onChange={setCategory} options={[{ value: "all", label: "All categories" }, ...distinct.cats.map((c) => ({ value: c, label: c }))]} />
        <FilterSelect label="Manufacturer" value={manufacturer} onChange={setManufacturer} options={[{ value: "all", label: "All manufacturers" }, ...distinct.mfrs.map((c) => ({ value: c, label: c }))]} />
        <FilterSelect label="Supplier" value={supplier} onChange={setSupplier} options={[{ value: "all", label: "All suppliers" }, ...distinct.sups.map((c) => ({ value: c, label: c }))]} />

        <span className="mx-1 h-5 w-px bg-sdc-border" aria-hidden />

        <Segmented
          value={dateType}
          onChange={(v) => setDateType(v as "purchase" | "invoice")}
          options={[{ value: "purchase", label: "Purchase" }, { value: "invoice", label: "Invoiced" }]}
        />
        <input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 rounded-md border border-sdc-border bg-white px-2 text-xs text-sdc-navy outline-none focus:border-sdc-blue" />
        <span className="text-xs text-sdc-gray-400">to</span>
        <input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 rounded-md border border-sdc-border bg-white px-2 text-xs text-sdc-navy outline-none focus:border-sdc-blue" />

        {/* Search */}
        <div className="flex h-8 min-w-[160px] flex-1 items-center gap-2 rounded-md border border-sdc-border bg-white px-2.5">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sdc-gray-400">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search parts…" aria-label="Search parts" className="w-full border-none bg-transparent text-xs text-sdc-navy outline-none placeholder:text-sdc-gray-400" />
        </div>

        <span className="ml-auto whitespace-nowrap text-xs font-semibold text-sdc-gray-600 tabular-nums">
          {num(filtered.length)} line items
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-sdc-border bg-white px-4 py-10 text-center text-sm text-sdc-gray-400 shadow-sm">
          No parts match the current filters.
        </p>
      ) : view === "list" ? (
        <PartsTableView parts={filtered} cols={visibleCols} onPartClick={onPartClick} />
      ) : (
        <PartsCardView parts={filtered} onPartClick={onPartClick} />
      )}
    </div>
  );
}

function PartRowCells({ p, cols }: { p: FlatPart; cols: { key: ColKey; label: string; align?: "right" }[] }) {
  const cell = (key: ColKey) => {
    switch (key) {
      case "qty":
        return <span className="text-[11px] font-semibold tabular-nums text-sdc-gray-600">{num(p.qty)}</span>;
      case "pn":
        return (
          <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-sdc-blue">
            {p.pn}
            <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.6" className="shrink-0 text-sdc-gray-400" aria-hidden>
              <rect x="5" y="5" width="8" height="8" rx="1.5" /><path d="M3 11 V3 a1 1 0 0 1 1-1 h7" strokeLinecap="round" />
            </svg>
          </span>
        );
      case "desc":
        return <span className="line-clamp-1 text-[11px] text-sdc-navy" title={p.desc}>{p.desc || "—"}</span>;
      case "parent":
        return p.parentPN ? (
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-mono text-[10px] font-semibold text-sdc-gray-600" title={p.parentPN}>{p.parentPN}</span>
            <span className="truncate text-[9px] text-sdc-gray-400" title={p.parentDesc}>{p.parentDesc || "—"}</span>
          </span>
        ) : (
          <span className="text-[10px] italic text-sdc-gray-400">Loose parts</span>
        );
      case "category":
        return <span className="line-clamp-1 text-[11px] text-sdc-gray-600" title={p.category ?? ""}>{p.category || "—"}</span>;
      case "mfr":
        return <span className="line-clamp-1 text-[11px] text-sdc-gray-600" title={p.manufacturer}>{p.manufacturer === "SDC" ? "In-house (SDC)" : p.manufacturer || "—"}</span>;
      case "supplier":
        return <SupplierChip supplier={p.supplier} />;
      case "po":
        return p.poNumber ? (
          <span className="font-mono text-[11px] font-semibold text-sdc-blue underline decoration-dotted underline-offset-2">{p.poNumber}</span>
        ) : (
          <span className="text-[10px] font-semibold text-sdc-red-text">NO PO</span>
        );
      case "purchased":
        return <span className="whitespace-nowrap font-mono text-[10px] text-sdc-gray-600">{fmtDate(p.purchasedDate)}</span>;
      case "exp":
        return <span className="whitespace-nowrap font-mono text-[10px] text-sdc-gray-600">{fmtDate(p.expectedDate)}</span>;
      case "lead":
        return p.leadDays != null && p.leadDays >= 0 ? (
          <span className="inline-flex items-center rounded bg-sdc-gray-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-sdc-gray-600">{p.leadDays}d</span>
        ) : (
          <span className="text-[10px] text-sdc-gray-400">—</span>
        );
      case "due":
        return <span className="whitespace-nowrap font-mono text-[10px] text-sdc-gray-600">{fmtDate(p.requiredDate)}</span>;
      case "status":
        return <StatusBadge status={p.status} />;
    }
  };
  return (
    <>
      {cols.map((c) => (
        <td key={c.key} className={`px-2 py-1.5 ${c.align === "right" ? "text-right" : ""}`}>
          {cell(c.key)}
        </td>
      ))}
    </>
  );
}

function PartsTableView({ parts, cols, onPartClick }: { parts: FlatPart[]; cols: { key: ColKey; label: string; align?: "right" }[]; onPartClick: (p: DrillablePart) => void }) {
  return (
    <div className="overflow-x-auto styled-scrollbar rounded-xl border border-sdc-border bg-white shadow-sm">
      <div className="max-h-[74vh] overflow-y-auto styled-scrollbar">
        <table className="w-full min-w-[1100px] border-collapse text-left">
          <thead className="sticky top-0 z-[2]">
            <tr className="bg-sdc-navy text-[9px] font-bold uppercase tracking-wider text-white">
              {cols.map((c) => (
                <th key={c.key} className={`px-2 py-2 font-bold ${c.align === "right" ? "text-right" : ""}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {parts.map((p, i) => (
              <tr
                key={`${p.id}-${i}`}
                data-part-key={String(p.id)}
                data-pn={p.pn}
                data-part-id={p.id}
                onClick={() => onPartClick(p)}
                title="Copy part # · locate row"
                className="cursor-pointer border-b border-sdc-border-soft/60 hover:bg-sdc-blue-light/25"
              >
                <PartRowCells p={p} cols={cols} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PartsCardView({ parts, onPartClick }: { parts: FlatPart[]; onPartClick: (p: DrillablePart) => void }) {
  return (
    <div className="grid max-h-[74vh] grid-cols-1 gap-2 overflow-y-auto styled-scrollbar sm:grid-cols-2 xl:grid-cols-3">
      {parts.map((p, i) => (
        <div
          key={`${p.id}-${i}`}
          data-part-key={String(p.id)}
          data-pn={p.pn}
          data-part-id={p.id}
          onClick={() => onPartClick(p)}
          className="flex cursor-pointer flex-col gap-2 rounded-lg border border-sdc-border bg-white p-3 shadow-sm hover:border-sdc-blue-100"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-mono text-[12px] font-semibold text-sdc-blue">{p.pn}</div>
              <div className="line-clamp-2 text-[11px] text-sdc-navy" title={p.desc}>{p.desc || "—"}</div>
            </div>
            <StatusBadge status={p.status} />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-sdc-gray-600">
            <span>Qty <span className="font-semibold tabular-nums text-sdc-navy">{num(p.qty)}</span></span>
            {p.category && <span>· {p.category}</span>}
            {p.poNumber ? <span>· PO <span className="font-mono font-semibold text-sdc-blue">{p.poNumber}</span></span> : <span className="font-semibold text-sdc-red-text">· NO PO</span>}
          </div>
          <div className="flex items-center justify-between gap-2">
            <SupplierChip supplier={p.supplier} />
            <span className="whitespace-nowrap font-mono text-[10px] text-sdc-gray-600">
              exp {fmtDate(p.expectedDate)}{p.leadDays != null && p.leadDays >= 0 ? ` · ${p.leadDays}d` : ""}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Risk cards: Delivery Slip + No Purchase Order ────────────────────────────

function RiskCards({ parts, onPartClick }: { parts: FlatPart[]; onPartClick: (p: DrillablePart) => void }) {
  const { recentlyReceived, noPo, noPoThisWeek, noPoOldest } = useMemo(() => {
    const now = Date.now();
    const recentCutoff = now - 14 * DAY;
    const weekEnd = now + 7 * DAY;

    const received = parts
      .filter((p) => {
        if (!p.receivedDate) return false;
        const t = new Date(p.receivedDate).getTime();
        return !Number.isNaN(t) && t >= recentCutoff && t <= now;
      })
      .sort((a, b) => (b.receivedDate ?? "").localeCompare(a.receivedDate ?? ""));

    const nopo = parts.filter((p) => p.status === "noPO");
    let thisWeek = 0;
    let oldest: string | null = null;
    for (const p of nopo) {
      if (!p.requiredDate) continue;
      const t = new Date(p.requiredDate).getTime();
      if (Number.isNaN(t)) continue;
      if (t <= weekEnd) thisWeek++;
      if (!oldest || p.requiredDate < oldest) oldest = p.requiredDate;
    }
    return { recentlyReceived: received, noPo: nopo, noPoThisWeek: thisWeek, noPoOldest: oldest };
  }, [parts]);

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {/* Delivery Slip */}
      <div className="overflow-hidden rounded-lg border border-sdc-border bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-sdc-border-soft bg-sdc-gray-100 px-4 py-2.5">
          <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-sdc-yellow-text">
            <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded bg-sdc-yellow-bg text-[12px] font-extrabold text-sdc-yellow-text">!</span>
            Delivery Slip
          </span>
          <span className="text-xs text-sdc-gray-600">
            <span className="font-bold text-sdc-navy tabular-nums">{recentlyReceived.length}</span> received in last 14 days
          </span>
        </div>
        <div className="max-h-40 overflow-y-auto styled-scrollbar">
          {recentlyReceived.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-sdc-gray-400">No parts received in the last 14 days.</p>
          ) : (
            recentlyReceived.map((p, i) => (
              <div
                key={`${p.id}-${i}`}
                onClick={() => onPartClick(p)}
                title="Copy part # · locate row"
                className="grid cursor-pointer grid-cols-[100px_1fr_auto] items-center gap-3 border-b border-sdc-border-soft/60 px-4 py-1.5 last:border-b-0 hover:bg-sdc-blue-light/30"
              >
                <span className="truncate font-mono text-[11px] font-semibold text-sdc-blue" title={p.pn}>{p.pn}</span>
                <span className="truncate text-[11px] text-sdc-navy" title={p.desc}>{p.desc || "—"}</span>
                <span className="whitespace-nowrap font-mono text-[10px] font-semibold text-sdc-green-text">{fmtDate(p.receivedDate)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* No Purchase Order */}
      <div className="overflow-hidden rounded-lg border border-sdc-border bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sdc-border-soft bg-sdc-gray-100 px-4 py-2.5">
          <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-sdc-red-text">
            <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded bg-sdc-red-bg text-[13px] font-extrabold text-sdc-red-text">×</span>
            No Purchase Order
          </span>
          <span className="text-xs text-sdc-gray-600">
            <span className="font-bold text-sdc-red-text tabular-nums">{noPo.length}</span> parts · {noPoThisWeek} due this week · oldest req {fmtDate(noPoOldest)}
          </span>
        </div>
        <div className="max-h-40 overflow-y-auto styled-scrollbar">
          {noPo.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-sdc-gray-400">All parts have purchase orders.</p>
          ) : (
            noPo.map((p, i) => (
              <div
                key={`${p.id}-${i}`}
                onClick={() => onPartClick(p)}
                title="Copy part # · locate row"
                className="grid cursor-pointer grid-cols-[100px_1fr_auto_auto] items-center gap-3 border-b border-sdc-border-soft/60 px-4 py-1.5 last:border-b-0 hover:bg-sdc-blue-light/30"
              >
                <span className="truncate font-mono text-[11px] font-semibold text-sdc-blue" title={p.pn}>{p.pn}</span>
                <span className="truncate text-[11px] text-sdc-navy" title={p.desc}>{p.desc || "—"}</span>
                <span className="whitespace-nowrap font-mono text-[10px] text-sdc-gray-600">{fmtDate(p.requiredDate)}</span>
                <span className="text-right text-[11px] font-semibold tabular-nums text-sdc-gray-600">×{num(p.qty)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Small filter controls ────────────────────────────────────────────────────

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex h-8 items-center rounded-md border border-sdc-border bg-white p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`h-7 rounded px-2.5 text-xs font-medium transition-colors ${
            value === o.value ? "bg-sdc-blue-light text-sdc-blue-dark" : "text-sdc-gray-600 hover:text-sdc-navy"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function FilterSelect({ value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const active = value !== "all";
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-8 max-w-[160px] rounded-md border bg-white px-2 text-xs font-medium outline-none focus:border-sdc-blue ${
        active ? "border-sdc-blue text-sdc-blue-dark" : "border-sdc-border text-sdc-gray-600"
      }`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
