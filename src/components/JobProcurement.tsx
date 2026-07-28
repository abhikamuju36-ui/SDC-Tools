"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

// PM-facing section (spec) label overrides — DISPLAY ONLY, keyed by SpecID.
// Matches the Scheduler's SECTION_LABEL_OVERRIDE so both apps read the same.
const SECTION_LABEL_OVERRIDE: Record<number, string> = {
  10: "Mechanical Design and Build",
  30: "Control-Related Parts",
  40: "Machine Testing-Related Parts",
  90: "Spare Parts",
};

const DAY = 86_400_000;

// ── Status model ─────────────────────────────────────────────────────────────
// One derived status per part (mirrors the Scheduler's _procPartStatus). Time-
// relative keys (overdue/soon) resolve against a `now` passed by the caller.
type StatusKey = "received" | "hold" | "noPO" | "overdue" | "soon" | "ordered";
type PartStatus = { key: StatusKey; label: string; cls: string; sub: string };

function partStatus(
  p: { status: BomPart["status"]; hold: boolean; expectedDate: string | null; requiredDate: string | null; poId?: string | null; poNumber?: string | null },
  now: number,
): PartStatus {
  if (p.status === "received") return { key: "received", label: "RECEIVED", cls: "received", sub: "" };
  if (p.hold) return { key: "hold", label: "ON HOLD", cls: "hold", sub: "in ETO" };
  if (p.status === "noPO") return { key: "noPO", label: "NO PO", cls: "noPO", sub: "" };
  const due = p.expectedDate || p.requiredDate;
  if (due) {
    const t = new Date(due).getTime();
    if (!Number.isNaN(t)) {
      const diff = Math.ceil((t - now) / DAY);
      if (diff < 0) return { key: "overdue", label: "OVERDUE", cls: "overdue", sub: `${Math.abs(diff)}d late` };
      if (diff <= 14) return { key: "soon", label: "DUE SOON", cls: "soon", sub: `in ${diff}d` };
      return { key: "ordered", label: "ON ORDER", cls: "ordered", sub: `in ${diff}d` };
    }
  }
  return { key: "ordered", label: "ON ORDER", cls: "ordered", sub: "" };
}

const STATUS_PILL: Record<StatusKey, string> = {
  received: "bg-sdc-green-bg text-sdc-green-text",
  ordered: "bg-sdc-blue-light text-sdc-blue-dark",
  soon: "bg-sdc-yellow-bg text-sdc-yellow-text",
  overdue: "bg-sdc-red-bg text-sdc-red-text",
  noPO: "border border-sdc-red-border bg-white text-sdc-red-text",
  hold: "bg-sdc-gray-100 text-sdc-gray-600",
};

function StatusPill({ st }: { st: PartStatus }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${STATUS_PILL[st.key]}`} title={st.sub || st.label}>
      {st.label}
      {st.sub ? <span className="font-medium opacity-70">{st.sub}</span> : null}
    </span>
  );
}

// Lead time chip — weeks between purchase and expected delivery. ≤4w ok (green),
// ≤8w warn (amber), >8w long (blue). Day count in the tooltip.
function LeadChip({ ordered, expected }: { ordered: string | null; expected: string | null }) {
  const days = daysBetween(ordered, expected);
  if (days == null || days < 0) return <span className="text-[10px] text-sdc-gray-400">—</span>;
  const wks = Math.round((days / 7) * 2) / 2;
  const cls = wks <= 4 ? "bg-sdc-green-bg text-sdc-green-text" : wks <= 8 ? "bg-sdc-yellow-bg text-sdc-yellow-text" : "bg-sdc-blue-light text-sdc-blue-dark";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${cls}`} title={`${days} day lead time (ordered → expected delivery)`}>
      {wks}w
    </span>
  );
}

// Due countdown chip — green "RCVD" when received, else weeks ahead (+Nw) /
// due-soon (+Nw amber) / late (-Nw red) vs. the expected date.
function DueChip({ expected, received, now }: { expected: string | null; received: boolean; now: number }) {
  if (received) return <span className="inline-flex items-center rounded bg-sdc-green-bg px-1.5 py-0.5 text-[9px] font-bold text-sdc-green-text" title="Already received">RCVD</span>;
  if (!expected) return <span className="text-[10px] text-sdc-gray-400">—</span>;
  const t = new Date(expected).getTime();
  if (Number.isNaN(t)) return <span className="text-[10px] text-sdc-gray-400">—</span>;
  const rawDays = (t - now) / DAY;
  const daysRounded = Math.round(rawDays);
  const wks = Math.round((rawDays / 7) * 2) / 2;
  const base = "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums";
  if (rawDays > 7) return <span className={`${base} bg-sdc-green-bg text-sdc-green-text`} title={`Due in ${daysRounded} days`}>+{wks}w</span>;
  if (rawDays >= 0) return <span className={`${base} bg-sdc-yellow-bg text-sdc-yellow-text`} title={`Due in ${daysRounded} days`}>+{wks}w</span>;
  const overWks = Math.round((Math.abs(rawDays) / 7) * 2) / 2;
  return <span className={`${base} bg-sdc-red-bg text-sdc-red-text`} title={`${Math.abs(daysRounded)} days overdue`}>-{overWks}w</span>;
}

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

function supplierInitials(supplier: string): string {
  return supplier
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// Square colored-initial avatar (same palette as SupplierChip), sized for the
// vendor card header.
function SupplierAvatar({ supplier, size = 30 }: { supplier: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded font-bold text-white"
      style={{ width: size, height: size, background: avatarColor(supplier), fontSize: Math.round(size * 0.38) }}
    >
      {supplierInitials(supplier)}
    </span>
  );
}

function SupplierChip({ supplier }: { supplier: string | null }) {
  if (!supplier) return <span className="text-[11px] text-sdc-gray-400">—</span>;
  const initials = supplierInitials(supplier);
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

// Readiness bar color: green >= 90, amber >= 60, red below (matches the
// Scheduler's _procBarColor threshold).
function barClasses(pct: number): { bar: string; text: string } {
  if (pct >= 90) return { bar: "bg-sdc-green", text: "text-sdc-green-text" };
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
  st: PartStatus;
};

function sectionLabelFor(section: BomNode): string {
  const specId = typeof section.id === "string" ? Number(section.id.replace(/\D/g, "")) : Number(section.id);
  const title = SECTION_LABEL_OVERRIDE[specId] ?? section.desc ?? "";
  return `Spec ${specId}${title ? ` — ${title}` : ""}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persisted UI state
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "sdc-etc-proc-state";

type PersistedState = {
  tab: "assemblies" | "parts";
  view: "list" | "card";
  query: string;
  status: "all" | StatusKey;
  category: string;
  manufacturer: string;
  supplier: string;
  dateType: "purchase" | "invoice";
  from: string;
  to: string;
  upcomingWeek: number;
  hiddenPartCols: ColKey[];
};

function loadPersisted(): Partial<PersistedState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// Build one PO's group (received/expected/status rollup) from the parts sharing
// a supplier + PO key. Shared by the Card view and the table/assembly PO-panel.
function makePoGroup(poKey: string, poParts: FlatPart[]): PoGroup {
  const isNoPo = poKey === NO_PO_KEY;
  const received = poParts.filter((p) => p.st.key === "received").length;
  const total = poParts.length;
  let expected: string | null = null;
  for (const p of poParts) {
    if (p.expectedDate && (!expected || p.expectedDate.slice(0, 10) < expected.slice(0, 10))) expected = p.expectedDate;
  }
  const pastDue = poParts.some((p) => p.st.key === "overdue");
  const status: PoGroup["status"] = isNoPo ? "noPO" : received >= total ? "received" : "ordered";
  return { poKey, poNumber: isNoPo ? null : poParts[0].poNumber, parts: poParts, received, total, expected, status, pastDue };
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function JobProcurement({ bom, partsLines }: { bom: JobBom; partsLines: PartsCostLine[] }) {
  const { toast } = useToast();
  const saved = useMemo(() => loadPersisted(), []);

  const [tab, setTab] = useState<"assemblies" | "parts">(() => saved.tab ?? "assemblies");

  // Parts List filter/view state lives here (not in PartsListTab) so a drill
  // from the Assemblies tab can reset every filter + force table mode before
  // the Parts List even mounts, guaranteeing the target row renders. All of it
  // is persisted to localStorage (see the effect below).
  const [view, setView] = useState<"list" | "card">(() => saved.view ?? "list");
  const [query, setQuery] = useState(() => saved.query ?? "");
  const [status, setStatus] = useState<"all" | StatusKey>(() => saved.status ?? "all");
  const [category, setCategory] = useState(() => saved.category ?? "all");
  const [manufacturer, setManufacturer] = useState(() => saved.manufacturer ?? "all");
  const [supplier, setSupplier] = useState(() => saved.supplier ?? "all");
  const [dateType, setDateType] = useState<"purchase" | "invoice">(() => saved.dateType ?? "purchase");
  const [from, setFrom] = useState(() => saved.from ?? "");
  const [to, setTo] = useState(() => saved.to ?? "");
  const [hidden, setHidden] = useState<Set<ColKey>>(() => new Set(saved.hiddenPartCols ?? []));
  const [upcomingWeek, setUpcomingWeek] = useState<number>(() => saved.upcomingWeek ?? 1);

  // Persist everything under one key.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const data: PersistedState = { tab, view, query, status, category, manufacturer, supplier, dateType, from, to, upcomingWeek, hiddenPartCols: [...hidden] };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* quota / disabled — non-fatal */
    }
  }, [tab, view, query, status, category, manufacturer, supplier, dateType, from, to, upcomingWeek, hidden]);

  // Drill target — key = String(part.id). `nonce` bumps on every drill so the
  // Parts List effect re-fires even when the same row is targeted twice.
  const [drill, setDrill] = useState<{ key: string; nonce: number }>({ key: "", nonce: 0 });

  // PO detail — the right-side sliding panel. null = closed.
  const [poPanel, setPoPanel] = useState<{ supplier: string; po: PoGroup } | null>(null);

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

  // Copy any string to the clipboard with a toast — reused by the PO-number
  // buttons (part numbers use drillToPart, which also copies).
  const copyText = useCallback(
    (text: string, label?: string) => {
      if (!text) return;
      navigator.clipboard?.writeText(text).then(() => toast(`Copied ${label ?? text}`, "success")).catch(() => {});
    },
    [toast],
  );

  const clearFilters = useCallback(() => {
    setStatus("all");
    setCategory("all");
    setManufacturer("all");
    setSupplier("all");
    setQuery("");
    setDateType("purchase");
    setFrom("");
    setTo("");
  }, []);

  const partsState = { view, setView, query, setQuery, status, setStatus, category, setCategory, manufacturer, setManufacturer, supplier, setSupplier, dateType, setDateType, from, setFrom, to, setTo, hidden, setHidden, upcomingWeek, setUpcomingWeek, clearFilters } as const;

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
    const now = Date.now();

    const enrich = (p: BomPart, parentPN: string, parentDesc: string, sectionId: string, sectionLabel: string) => {
      if (seen.has(p.id)) return;
      seen.add(p.id);
      const line = lineIndex.get(normPn(p.pn))?.[0] ?? null;
      const flat: FlatPart = {
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
        st: partStatus(p, now),
      };
      out.push(flat);
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
    const received = parts.filter((p) => p.st.key === "received").length;
    const noPO = parts.filter((p) => p.st.key === "noPO").length;
    const pct = total ? Math.round((received / total) * 100) : 0;
    return { total, received, noPO, pct };
  }, [parts]);

  const assembliesCount = useMemo(
    () => bom.roots.reduce((s, sec) => s + sec.nestedAssemblies, 0),
    [bom],
  );

  // Open the PO side panel for a supplier + PO number, gathering that PO's parts
  // from the full (unfiltered) buy-list so the panel is always complete.
  const openPoFor = useCallback(
    (sup: string | null, poNumber: string | null) => {
      const supKey = sup ?? "Unknown supplier";
      const poKey = poNumber ?? NO_PO_KEY;
      const poParts = parts.filter((p) => (p.supplier ?? "Unknown supplier") === supKey && (p.poNumber ?? NO_PO_KEY) === poKey);
      if (!poParts.length) return;
      setPoPanel({ supplier: supKey, po: makePoGroup(poKey, poParts) });
    },
    [parts],
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
        <AssembliesTab bom={bom} onPartClick={drillToPart} onOpenPo={openPoFor} />
      ) : (
        <PartsListTab
          parts={parts}
          state={partsState}
          drill={drill}
          onPartClick={drillToPart}
          onCopy={copyText}
          onOpenPo={openPoFor}
        />
      )}

      {poPanel && (
        <PoPanel
          supplier={poPanel.supplier}
          po={poPanel.po}
          onClose={() => setPoPanel(null)}
          onPartClick={drillToPart}
        />
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

function AssembliesTab({ bom, onPartClick, onOpenPo }: { bom: JobBom; onPartClick: (p: DrillablePart) => void; onOpenPo: (supplier: string | null, poNumber: string | null) => void }) {
  const now = useMemo(() => Date.now(), []);
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
                  <AssemblyRow key={asm.key} node={asm} depth={0} collapsed={collapsed} toggle={toggle} pricedByKey={pricedByKey} onPartClick={onPartClick} onOpenPo={onOpenPo} now={now} />
                ))}
                {section.parts.length > 0 && <PartsDetailTable parts={section.parts} depth={0} onPartClick={onPartClick} onOpenPo={onOpenPo} now={now} />}
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
  onOpenPo,
  now,
}: {
  node: BomNode;
  depth: number;
  collapsed: Set<string>;
  toggle: (key: string) => void;
  pricedByKey: Map<string, { priced: number; total: number }>;
  onPartClick: (p: DrillablePart) => void;
  onOpenPo: (supplier: string | null, poNumber: string | null) => void;
  now: number;
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
            <AssemblyRow key={child.key} node={child} depth={depth + 1} collapsed={collapsed} toggle={toggle} pricedByKey={pricedByKey} onPartClick={onPartClick} onOpenPo={onOpenPo} now={now} />
          ))}
          {node.parts.length > 0 && <PartsDetailTable parts={node.parts} depth={depth + 1} onPartClick={onPartClick} onOpenPo={onOpenPo} now={now} />}
        </div>
      )}
    </div>
  );
}

function PartsDetailTable({
  parts,
  depth,
  onPartClick,
  onOpenPo,
  now,
}: {
  parts: BomPart[];
  depth: number;
  onPartClick: (p: DrillablePart) => void;
  onOpenPo: (supplier: string | null, poNumber: string | null) => void;
  now: number;
}) {
  return (
    <div className="bg-sdc-gray-50/60" style={{ paddingLeft: `${depth * 18}px` }}>
      <div className="overflow-x-auto styled-scrollbar">
        <table className="w-full min-w-[980px] border-collapse text-left">
          <thead>
            <tr className="bg-sdc-navy text-[9px] font-bold uppercase tracking-wider text-white">
              <th className="px-2 py-1.5 font-bold">Status</th>
              <th className="px-2 py-1.5 text-right font-bold">Qty</th>
              <th className="px-2 py-1.5 font-bold">Part #</th>
              <th className="px-2 py-1.5 font-bold">Description</th>
              <th className="px-2 py-1.5 font-bold">Manufacturer</th>
              <th className="px-2 py-1.5 font-bold">Supplier</th>
              <th className="px-2 py-1.5 font-bold">PO #</th>
              <th className="px-2 py-1.5 font-bold">Req Date</th>
              <th className="px-2 py-1.5 font-bold">Expected</th>
              <th className="px-2 py-1.5 text-right font-bold">Unit $</th>
              <th className="px-2 py-1.5 text-right font-bold">Extended</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p, i) => {
              const st = partStatus(p, now);
              return (
                <tr
                  key={`${p.id}-${i}`}
                  onClick={() => onPartClick(p)}
                  title="Open in Parts List · copies part #"
                  className={`cursor-pointer border-b border-sdc-border-soft/60 hover:bg-sdc-blue-light/25 ${st.key === "overdue" ? "bg-sdc-red-bg/40" : ""}`}
                >
                  <td className="px-2 py-1.5"><StatusPill st={st} /></td>
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
                  <td className="px-2 py-1.5">
                    {p.poId ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onOpenPo(p.supplier, p.poId); }}
                        title="View PO"
                        className="font-mono text-[10px] font-semibold text-sdc-blue underline decoration-dotted underline-offset-2"
                      >
                        {p.poId}
                      </button>
                    ) : (
                      <span className="text-[10px] font-semibold text-sdc-red-text">NO PO</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap font-mono text-[10px] text-sdc-gray-600">{fmtDate(p.requiredDate)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap font-mono text-[10px] text-sdc-gray-600">{fmtDate(p.expectedDate)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-[10px] text-sdc-gray-600">{p.unitPrice > 0 ? usd(p.unitPrice) : "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-[10px] font-semibold text-sdc-navy">{p.unitPrice > 0 ? usd(p.unitPrice * p.qty) : "—"}</td>
                </tr>
              );
            })}
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
  status: "all" | StatusKey;
  setStatus: (v: "all" | StatusKey) => void;
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
  hidden: Set<ColKey>;
  setHidden: (updater: (prev: Set<ColKey>) => Set<ColKey>) => void;
  upcomingWeek: number;
  setUpcomingWeek: (n: number) => void;
  clearFilters: () => void;
};

function PartsListTab({
  parts,
  state,
  drill,
  onPartClick,
  onCopy,
  onOpenPo,
}: {
  parts: FlatPart[];
  state: PartsListState;
  drill: { key: string; nonce: number };
  onPartClick: (p: DrillablePart) => void;
  onCopy: (text: string, label?: string) => void;
  onOpenPo: (supplier: string | null, poNumber: string | null) => void;
}) {
  const { view, setView, query, setQuery, status, setStatus, category, setCategory, manufacturer, setManufacturer, supplier, setSupplier, dateType, setDateType, from, setFrom, to, setTo, hidden, setHidden, upcomingWeek, setUpcomingWeek, clearFilters } = state;
  const now = useMemo(() => Date.now(), []);
  const filtersActive =
    status !== "all" || category !== "all" || manufacturer !== "all" || supplier !== "all" || query !== "" || dateType !== "purchase" || from !== "" || to !== "";

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
      if (status !== "all" && p.st.key !== status) return false;
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
      <RiskCards parts={parts} onPartClick={onPartClick} now={now} upcomingWeek={upcomingWeek} setUpcomingWeek={setUpcomingWeek} />

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sdc-border bg-white px-3 py-2.5 shadow-sm">
        {/* List / Card */}
        <Segmented
          value={view}
          onChange={(v) => setView(v as "list" | "card")}
          options={[{ value: "list", label: "List" }, { value: "card", label: "Card" }]}
        />
        {/* Columns toggle (table mode only) */}
        {view === "list" && (
          <details className="relative">
            <summary className={`flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-sdc-blue-light ${hidden.size ? "border-sdc-blue bg-sdc-blue-light text-sdc-blue-dark" : "border-sdc-border bg-white text-sdc-navy"}`}>
              Columns
              {hidden.size > 0 && <span className="inline-flex min-w-[16px] items-center justify-center rounded-full bg-sdc-blue px-1 text-[10px] font-bold text-white tabular-nums">{hidden.size}</span>}
              <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6 L8 11 L13 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </summary>
            <div className="absolute left-0 z-20 mt-1 max-h-80 w-52 overflow-auto styled-scrollbar rounded-lg border border-sdc-border bg-white p-1.5 shadow-lg">
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
              <div className="mt-1.5 flex gap-2 border-t border-sdc-border-soft pt-1.5">
                <button type="button" onClick={() => setHidden(() => new Set())} className="rounded-md border border-sdc-border bg-white px-2 py-1 text-[11px] font-medium text-sdc-navy hover:bg-sdc-blue-light">Show all</button>
                <button type="button" onClick={() => setHidden(() => new Set())} className="rounded-md border border-sdc-border bg-white px-2 py-1 text-[11px] font-medium text-sdc-navy hover:bg-sdc-blue-light">Reset</button>
              </div>
            </div>
          </details>
        )}

        <span className="mx-1 h-5 w-px bg-sdc-border" aria-hidden />

        <FilterSelect label="Status" value={status} onChange={(v) => setStatus(v as typeof status)} options={[
          { value: "all", label: "All status" },
          { value: "received", label: "Received" },
          { value: "ordered", label: "On order" },
          { value: "soon", label: "Due soon" },
          { value: "overdue", label: "Overdue" },
          { value: "noPO", label: "No PO" },
          { value: "hold", label: "On hold" },
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

        {filtersActive && (
          <button type="button" onClick={clearFilters} className="h-8 rounded-md border border-sdc-border bg-white px-3 text-xs font-medium text-sdc-navy hover:bg-sdc-blue-light">
            Clear
          </button>
        )}

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
        <PartsTableView parts={filtered} cols={visibleCols} onPartClick={onPartClick} onOpenPo={onOpenPo} now={now} />
      ) : (
        <PartsCardView parts={filtered} onCopy={onCopy} onOpenPo={onOpenPo} />
      )}
    </div>
  );
}

function PartRowCells({
  p,
  cols,
  now,
  onOpenPo,
}: {
  p: FlatPart;
  cols: { key: ColKey; label: string; align?: "right" }[];
  now: number;
  onOpenPo: (supplier: string | null, poNumber: string | null) => void;
}) {
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
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenPo(p.supplier, p.poNumber); }}
            title="View PO"
            className="font-mono text-[11px] font-semibold text-sdc-blue underline decoration-dotted underline-offset-2"
          >
            {p.poNumber}
          </button>
        ) : (
          <span className="text-[10px] font-semibold text-sdc-red-text">NO PO</span>
        );
      case "purchased":
        return <span className="whitespace-nowrap font-mono text-[10px] text-sdc-gray-600">{fmtDate(p.purchasedDate)}</span>;
      case "exp":
        return <span className="whitespace-nowrap font-mono text-[10px] text-sdc-gray-600">{fmtDate(p.expectedDate)}</span>;
      case "lead":
        return <LeadChip ordered={p.purchasedDate} expected={p.expectedDate} />;
      case "due":
        return <DueChip expected={p.expectedDate} received={p.st.key === "received"} now={now} />;
      case "status":
        return <StatusPill st={p.st} />;
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

function PartsTableView({
  parts,
  cols,
  onPartClick,
  onOpenPo,
  now,
}: {
  parts: FlatPart[];
  cols: { key: ColKey; label: string; align?: "right" }[];
  onPartClick: (p: DrillablePart) => void;
  onOpenPo: (supplier: string | null, poNumber: string | null) => void;
  now: number;
}) {
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
                className={`cursor-pointer border-b border-sdc-border-soft/60 hover:bg-sdc-blue-light/25 ${p.st.key === "overdue" ? "bg-sdc-red-bg/40" : ""}`}
              >
                <PartRowCells p={p} cols={cols} now={now} onOpenPo={onOpenPo} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const NO_PO_KEY = "__NO_PO__";

type PoGroup = {
  poKey: string;
  poNumber: string | null;
  parts: FlatPart[];
  received: number;
  total: number;
  expected: string | null; // soonest expected date among the PO's parts
  status: "received" | "ordered" | "noPO";
  pastDue: boolean;
};

type VendorGroup = {
  supplier: string;
  pos: PoGroup[];
  received: number;
  total: number;
  pct: number;
  poCount: number; // excludes the NO-PO group
  status: { label: string; cls: string };
  order: number; // sort priority (0 = most urgent)
  pastDue: boolean;
};

// Vendor card layout — group the flat parts by supplier → PO, matching the
// Scheduler drawer's Card mode. One card per supplier, a mini PO table inside,
// and each PO row expands inline to reveal its parts.
function PartsCardView({
  parts,
  onCopy,
  onOpenPo,
}: {
  parts: FlatPart[];
  onCopy: (text: string, label?: string) => void;
  onOpenPo: (supplier: string | null, poNumber: string | null) => void;
}) {
  const vendors = useMemo<VendorGroup[]>(() => {
    const byVendor = new Map<string, Map<string, FlatPart[]>>();
    for (const p of parts) {
      const vKey = p.supplier ?? "Unknown supplier";
      const poKey = p.poNumber ?? NO_PO_KEY;
      let pos = byVendor.get(vKey);
      if (!pos) byVendor.set(vKey, (pos = new Map()));
      const arr = pos.get(poKey);
      if (arr) arr.push(p);
      else pos.set(poKey, [p]);
    }

    const groups: VendorGroup[] = [];
    for (const [supplier, poMap] of byVendor) {
      const pos: PoGroup[] = [];
      let vReceived = 0;
      let vTotal = 0;
      let vPastDue = false;
      for (const [poKey, poParts] of poMap) {
        const po = makePoGroup(poKey, poParts);
        pos.push(po);
        vReceived += po.received;
        vTotal += po.total;
        if (po.pastDue) vPastDue = true;
      }
      // Incomplete first, received last; then most parts first.
      pos.sort((a, b) => {
        const ar = a.status === "received" ? 1 : 0;
        const br = b.status === "received" ? 1 : 0;
        if (ar !== br) return ar - br;
        return b.total - a.total;
      });
      const pct = vTotal ? Math.round((vReceived / vTotal) * 100) : 0;
      const poCount = pos.filter((p) => p.poKey !== NO_PO_KEY).length;
      let status: VendorGroup["status"];
      let order: number;
      if (vPastDue) {
        status = { label: "PAST DUE", cls: "bg-sdc-red-bg text-sdc-red-text" };
        order = 0;
      } else if (pct >= 90) {
        status = { label: "RECEIVED", cls: "bg-sdc-green-bg text-sdc-green-text" };
        order = 3;
      } else if (pct >= 60) {
        status = { label: "PARTIAL", cls: "bg-sdc-yellow-bg text-sdc-yellow-text" };
        order = 2;
      } else {
        status = { label: "PENDING", cls: "bg-sdc-blue-light text-sdc-blue-dark" };
        order = 1;
      }
      groups.push({ supplier, pos, received: vReceived, total: vTotal, pct, poCount, status, order, pastDue: vPastDue });
    }
    groups.sort((a, b) => a.order - b.order || a.pct - b.pct || a.supplier.localeCompare(b.supplier));
    return groups;
  }, [parts]);

  // Vendor readiness bar color: >=90 green, >=60 amber, else blue.
  const vendorBar = (pct: number) => (pct >= 90 ? "bg-sdc-green" : pct >= 60 ? "bg-sdc-yellow" : "bg-sdc-blue");
  const vendorText = (pct: number) => (pct >= 90 ? "text-sdc-green-text" : pct >= 60 ? "text-sdc-yellow-text" : "text-sdc-blue-dark");
  const dotColor = (s: PoGroup["status"]) => (s === "received" ? "bg-sdc-green" : s === "noPO" ? "bg-sdc-red" : "bg-sdc-blue");

  return (
    <div
      className="grid max-h-[74vh] gap-3 overflow-y-auto styled-scrollbar"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}
    >
      {vendors.map((v) => (
        <div key={v.supplier} className="flex flex-col overflow-hidden rounded-lg border border-sdc-border bg-white shadow-sm">
          {/* Header */}
          <div className="flex flex-col gap-2 border-b border-sdc-border-soft p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <SupplierAvatar supplier={v.supplier} size={30} />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-bold text-sdc-navy" title={v.supplier}>{v.supplier}</div>
                  <div className="text-[10px] text-sdc-gray-400">
                    {v.poCount} PO{v.poCount === 1 ? "" : "s"} · {v.total} item{v.total === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${v.status.cls}`}>{v.status.label}</span>
            </div>
            <div className="flex items-center gap-2" title={`${v.pct}% received`}>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sdc-gray-100">
                <div className={`h-full rounded-full ${vendorBar(v.pct)}`} style={{ width: `${Math.min(100, v.pct)}%` }} />
              </div>
              <span className={`w-9 shrink-0 text-right text-[11px] font-semibold tabular-nums ${vendorText(v.pct)}`}>{v.pct}%</span>
            </div>
          </div>

          {/* Mini PO table */}
          <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 bg-sdc-gray-100 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-sdc-gray-400">
            <span>PO #</span>
            <span className="text-right">Received</span>
            <span className="text-right">Date</span>
            <span />
          </div>
          <div className="max-h-56 overflow-y-auto styled-scrollbar">
            {v.pos.map((po) => {
              const rowKey = `${v.supplier}::${po.poKey}`;
              return (
                <button
                  key={rowKey}
                  type="button"
                  onClick={() => onOpenPo(v.supplier, po.poNumber)}
                  title="Open PO details"
                  className="grid w-full grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-b border-sdc-border-soft/60 px-3 py-1.5 text-left last:border-b-0 hover:bg-sdc-blue-light/30"
                >
                  {po.poNumber ? (
                    <span
                      role="button"
                      tabIndex={0}
                      title="Copy PO number"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCopy(po.poNumber!, `PO ${po.poNumber}`);
                      }}
                      className="truncate font-mono text-[11px] font-semibold text-sdc-blue underline decoration-dotted underline-offset-2"
                    >
                      {po.poNumber}
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold text-sdc-red-text">NO PO</span>
                  )}
                  <span className="text-right text-[10px] tabular-nums text-sdc-gray-600">{po.received}/{po.total} rcvd</span>
                  <span className={`text-right font-mono text-[10px] ${po.pastDue ? "text-sdc-red-text" : "text-sdc-gray-600"}`}>{fmtDate(po.expected)}</span>
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${dotColor(po.status)}`} />
                    <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" className="text-sdc-gray-400" aria-hidden>
                      <path d="M6 3.5 L10.5 8 L6 12.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {vendors.length === 0 && (
        <p className="col-span-full rounded-xl border border-sdc-border bg-white px-4 py-10 text-center text-sm text-sdc-gray-400 shadow-sm">
          No parts match the current filters.
        </p>
      )}
    </div>
  );
}

// ── PO detail — right-side sliding panel ─────────────────────────────────────

function PoPanel({
  supplier,
  po,
  onClose,
  onPartClick,
}: {
  supplier: string;
  po: PoGroup;
  onClose: () => void;
  onPartClick: (p: DrillablePart) => void;
}) {
  // Mount closed, then flip to open on the next frame so the slide-in plays.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setOpen(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  // Animate out, then unmount via the parent after the transition.
  const requestClose = useCallback(() => {
    setOpen(false);
    window.setTimeout(onClose, 200);
  }, [onClose]);

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const stats = useMemo(() => {
    const now = Date.now();
    let ordered: string | null = null; // earliest purchase
    let due: string | null = null; // latest expected
    let value = 0;
    for (const p of po.parts) {
      if (p.purchasedDate && (!ordered || p.purchasedDate.slice(0, 10) < ordered.slice(0, 10))) ordered = p.purchasedDate;
      if (p.expectedDate && (!due || p.expectedDate.slice(0, 10) > due.slice(0, 10))) due = p.expectedDate;
      value += (p.unitPrice || 0) * (p.qty || 0);
    }
    const pct = po.total ? Math.round((po.received / po.total) * 100) : 0;
    const isPastDue = (p: FlatPart) => {
      if (p.status === "received" || !p.expectedDate) return false;
      const t = new Date(p.expectedDate).getTime();
      return !Number.isNaN(t) && t < now;
    };
    return { ordered, due, value, pct, isPastDue };
  }, [po]);

  const badge = po.pastDue
    ? { label: "PAST DUE", cls: "bg-sdc-red-bg text-sdc-red-text" }
    : stats.pct >= 90
      ? { label: "RECEIVED", cls: "bg-sdc-green-bg text-sdc-green-text" }
      : stats.pct >= 60
        ? { label: "PARTIAL", cls: "bg-sdc-yellow-bg text-sdc-yellow-text" }
        : { label: "PENDING", cls: "bg-sdc-blue-light text-sdc-blue-dark" };

  const barColor = stats.pct >= 90 ? "bg-sdc-green" : stats.pct >= 60 ? "bg-sdc-yellow" : "bg-sdc-blue";

  const handlePart = (p: FlatPart) => {
    onPartClick(p);
    requestClose();
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`PO ${po.poNumber ?? "without number"}`}>
      {/* Backdrop */}
      <div
        onClick={requestClose}
        className={`absolute inset-0 bg-sdc-navy/40 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
      />
      {/* Panel */}
      <aside
        className={`absolute right-0 top-0 flex h-full w-[440px] max-w-[92vw] flex-col bg-white shadow-xl transition-transform duration-200 ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex flex-col gap-3 border-b border-sdc-border-soft p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <SupplierAvatar supplier={supplier} size={38} />
              <div className="min-w-0">
                <div className="truncate text-[15px] font-bold text-sdc-navy" title={supplier}>{supplier}</div>
                <div className="font-mono text-[12px] text-sdc-gray-600">{po.poNumber ? `PO #${po.poNumber}` : "Parts without PO"}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${badge.cls}`}>{badge.label}</span>
              <button type="button" onClick={requestClose} aria-label="Close" className="rounded p-1 text-sdc-gray-400 hover:bg-sdc-gray-100 hover:text-sdc-navy">
                <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 4 L12 12 M12 4 L4 12" strokeLinecap="round" /></svg>
              </button>
            </div>
          </div>

          {/* Summary stats */}
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <Stat label="Ordered" value={fmtDate(stats.ordered)} />
            <Stat label="Due" value={fmtDate(stats.due)} tone={po.pastDue ? "danger" : undefined} />
            <Stat label="PO Value" value={stats.value > 0 ? usd(stats.value) : "—"} />
            <div className="ml-auto min-w-[120px]">
              <div className="mb-1 flex items-center justify-between text-[10px]">
                <span className="text-sdc-gray-400">{po.received}/{po.total} received</span>
                <span className="font-semibold text-sdc-navy tabular-nums">{stats.pct}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-sdc-gray-100">
                <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, stats.pct)}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* Lines table */}
        <div className="flex-1 overflow-y-auto styled-scrollbar">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 z-[1]">
              <tr className="bg-sdc-navy text-[9px] font-bold uppercase tracking-wider text-white">
                <th className="px-3 py-2 font-bold">Part</th>
                <th className="px-2 py-2 text-right font-bold">Qty</th>
                <th className="px-2 py-2 font-bold">Ordered</th>
                <th className="px-2 py-2 font-bold">Expected</th>
                <th className="px-2 py-2 font-bold">Received</th>
                <th className="px-3 py-2 text-right font-bold">Price</th>
              </tr>
            </thead>
            <tbody>
              {po.parts.map((p, i) => {
                const isRcvd = p.status === "received" || !!p.receivedDate;
                const isPast = stats.isPastDue(p);
                const rowTint = isRcvd ? "bg-sdc-green-bg/50" : isPast ? "bg-sdc-red-bg/50" : "bg-sdc-yellow-bg/40";
                return (
                  <tr key={`${p.id}-${i}`} className={`border-b border-sdc-border-soft/60 ${rowTint}`}>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => handlePart(p)}
                        title="Copy part # · locate row"
                        className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-sdc-blue"
                      >
                        {p.pn}
                        <svg viewBox="0 0 16 16" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.6" className="shrink-0 text-sdc-gray-400" aria-hidden>
                          <rect x="5" y="5" width="8" height="8" rx="1.5" /><path d="M3 11 V3 a1 1 0 0 1 1-1 h7" strokeLinecap="round" />
                        </svg>
                      </button>
                      <div className="line-clamp-1 text-[10px] text-sdc-gray-600" title={p.desc}>{p.desc || "—"}</div>
                    </td>
                    <td className="px-2 py-2 text-right text-[11px] font-semibold tabular-nums text-sdc-gray-600">{num(p.qty)}</td>
                    <td className="px-2 py-2 whitespace-nowrap font-mono text-[10px] text-sdc-gray-600">{fmtDate(p.purchasedDate)}</td>
                    <td className={`px-2 py-2 whitespace-nowrap font-mono text-[10px] ${isPast ? "font-semibold text-sdc-red-text" : "text-sdc-gray-600"}`}>{fmtDate(p.expectedDate)}</td>
                    <td className="px-2 py-2 whitespace-nowrap font-mono text-[10px]">
                      {isRcvd ? (
                        <span className="font-semibold text-sdc-green-text">✓ {fmtDate(p.receivedDate)}</span>
                      ) : (
                        <span className="text-sdc-yellow-text">Exp {fmtDate(p.expectedDate)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[10px] text-sdc-gray-600">{p.unitPrice > 0 ? usd(p.unitPrice) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </aside>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] font-bold uppercase tracking-wider text-sdc-gray-400">{label}</span>
      <span className={`font-mono text-[12px] font-semibold tabular-nums ${tone === "danger" ? "text-sdc-red-text" : "text-sdc-navy"}`}>{value}</span>
    </div>
  );
}

// ── Generic right-side sliding panel (shared slide/close mechanics) ──────────

function SidePanel({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setOpen(true));
    return () => window.cancelAnimationFrame(id);
  }, []);
  const requestClose = useCallback(() => {
    setOpen(false);
    window.setTimeout(onClose, 200);
  }, [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div onClick={requestClose} className={`absolute inset-0 bg-sdc-navy/40 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`} />
      <aside className={`absolute right-0 top-0 flex h-full w-[560px] max-w-[94vw] flex-col bg-white shadow-xl transition-transform duration-200 ${open ? "translate-x-0" : "translate-x-full"}`}>
        <div className="flex items-center justify-between gap-3 border-b border-sdc-border-soft p-4">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold text-sdc-navy">{title}</div>
            {subtitle ? <div className="text-[12px] text-sdc-gray-600">{subtitle}</div> : null}
          </div>
          <button type="button" onClick={requestClose} aria-label="Close" className="rounded p-1 text-sdc-gray-400 hover:bg-sdc-gray-100 hover:text-sdc-navy">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 4 L12 12 M12 4 L4 12" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto styled-scrollbar">{children}</div>
      </aside>
    </div>
  );
}

// ── Risk panels: Delivery Slip · No Purchase Order · Upcoming Deliveries ─────

function startOfTodayMs(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function dueMs(p: FlatPart): number {
  const d = p.expectedDate || p.requiredDate;
  if (!d) return NaN;
  return new Date(d).getTime();
}
function reqMs(p: FlatPart): number {
  return p.requiredDate ? new Date(p.requiredDate).getTime() : NaN;
}

function RiskCards({
  parts,
  onPartClick,
  now,
  upcomingWeek,
  setUpcomingWeek,
}: {
  parts: FlatPart[];
  onPartClick: (p: DrillablePart) => void;
  now: number;
  upcomingWeek: number;
  setUpcomingWeek: (n: number) => void;
}) {
  const [seeAll, setSeeAll] = useState<null | "delivery" | "nopo" | "upcoming">(null);

  const risk = useMemo(() => {
    const today = startOfTodayMs(now);

    // Delivery Slip — upcoming/overdue deliveries: has a PO, not received, due
    // within today ±7 days.
    const slipStart = today - 7 * DAY;
    const slipEnd = today + 8 * DAY;
    const delivery = parts
      .filter((p) => {
        if (!p.poNumber || p.st.key === "received") return false;
        const t = dueMs(p);
        return Number.isFinite(t) && t >= slipStart && t < slipEnd;
      })
      .sort((a, b) => dueMs(a) - dueMs(b));
    const lateParts = delivery.filter((p) => Number.isFinite(dueMs(p)) && dueMs(p) < today);
    const deliveryAvgLate = lateParts.length
      ? Math.round(lateParts.reduce((s, p) => s + Math.ceil((today - dueMs(p)) / DAY), 0) / lateParts.length)
      : 0;
    const deliveryOldest = delivery.reduce<string | null>((acc, p) => {
      if (!p.requiredDate) return acc;
      return !acc || p.requiredDate < acc ? p.requiredDate : acc;
    }, null);

    // No PO — dedupe by part number, exclude on-hold + received.
    const seenPn = new Set<string>();
    const noPo = parts.filter((p) => {
      if (p.poNumber) return false;
      if (p.st.key === "received" || p.hold) return false;
      const key = normPn(p.pn);
      if (seenPn.has(key)) return false;
      seenPn.add(key);
      return true;
    });
    const weekEnd = today + 7 * DAY;
    let noPoThisWeek = 0;
    let noPoOldest: string | null = null;
    for (const p of noPo) {
      const t = reqMs(p);
      if (Number.isFinite(t) && t <= weekEnd) noPoThisWeek++;
      if (p.requiredDate && (!noPoOldest || p.requiredDate < noPoOldest)) noPoOldest = p.requiredDate;
    }

    // Upcoming — not received, due tomorrow through ~8 weeks out.
    const upStart = today + 1 * DAY;
    const upEnd = today + 57 * DAY;
    const upcoming = parts
      .filter((p) => {
        if (p.st.key === "received") return false;
        const t = dueMs(p);
        return Number.isFinite(t) && t >= upStart && t < upEnd;
      })
      .sort((a, b) => dueMs(a) - dueMs(b));
    const weekData = Array.from({ length: 8 }, (_, i) => {
      const w = i + 1;
      const wStart = today + ((w - 1) * 7 + 1) * DAY;
      const wEnd = today + (w * 7 + 1) * DAY;
      const wParts = upcoming.filter((p) => {
        const t = dueMs(p);
        return Number.isFinite(t) && t >= wStart && t < wEnd;
      });
      return { week: w, parts: wParts, count: wParts.length };
    });

    return { delivery, deliveryAvgLate, deliveryOldest, noPo, noPoThisWeek, noPoOldest, upcoming, weekData };
  }, [parts, now]);

  const selectedWeek = risk.weekData.find((w) => w.week === upcomingWeek) ?? risk.weekData[0];
  const selectedParts = selectedWeek?.parts ?? [];
  const upSuppliers = new Set(selectedParts.map((p) => p.supplier).filter(Boolean)).size;
  const upNearest = selectedParts.length ? selectedParts.map(dueMs).filter(Number.isFinite).sort((a, b) => a - b)[0] : null;

  const drillRow = (p: FlatPart) => onPartClick(p);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Delivery Slip */}
        <div className="overflow-hidden rounded-lg border border-sdc-border bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sdc-border-soft bg-sdc-gray-100 px-4 py-2.5">
            <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-sdc-yellow-text">
              <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded bg-sdc-yellow-bg text-[12px] font-extrabold text-sdc-yellow-text">!</span>
              Delivery Slip
            </span>
            <div className="flex items-center gap-4">
              <Stat label="Parts" value={num(risk.delivery.length)} />
              <Stat label="Avg Late" value={`+${risk.deliveryAvgLate}d`} tone={risk.deliveryAvgLate > 0 ? "danger" : undefined} />
              <Stat label="Oldest Req" value={fmtDate(risk.deliveryOldest)} />
              <SeeAllBtn onClick={() => setSeeAll("delivery")} disabled={risk.delivery.length === 0} />
            </div>
          </div>
          <div className="max-h-40 overflow-y-auto styled-scrollbar">
            {risk.delivery.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-sdc-gray-400">No deliveries due this week.</p>
            ) : (
              risk.delivery.map((p, i) => <SlipRow key={`${p.id}-${i}`} p={p} now={now} onClick={() => drillRow(p)} />)
            )}
          </div>
        </div>

        {/* No Purchase Order */}
        <div className="overflow-hidden rounded-lg border border-sdc-border bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sdc-border-soft bg-sdc-gray-100 px-4 py-2.5">
            <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-sdc-red-text">
              <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded bg-sdc-red-bg text-[13px] font-extrabold text-sdc-red-text">×</span>
              No Purchase Order
            </span>
            <div className="flex items-center gap-4">
              <Stat label="Parts" value={num(risk.noPo.length)} tone={risk.noPo.length ? "danger" : undefined} />
              <Stat label="This Week" value={num(risk.noPoThisWeek)} />
              <Stat label="Oldest Req" value={fmtDate(risk.noPoOldest)} />
              <SeeAllBtn onClick={() => setSeeAll("nopo")} disabled={risk.noPo.length === 0} />
            </div>
          </div>
          <div className="max-h-40 overflow-y-auto styled-scrollbar">
            {risk.noPo.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-sdc-gray-400">All parts have purchase orders.</p>
            ) : (
              risk.noPo.map((p, i) => (
                <div
                  key={`${p.id}-${i}`}
                  onClick={() => drillRow(p)}
                  title="Copy part # · locate row"
                  className="grid cursor-pointer grid-cols-[100px_1fr_auto] items-center gap-3 border-b border-sdc-border-soft/60 px-4 py-1.5 last:border-b-0 hover:bg-sdc-blue-light/30"
                >
                  <span className="truncate font-mono text-[11px] font-semibold text-sdc-blue" title={p.pn}>{p.pn}</span>
                  <span className="truncate text-[11px] text-sdc-navy" title={p.desc}>{p.desc || "—"}</span>
                  <span className="whitespace-nowrap font-mono text-[10px] text-sdc-gray-600">{fmtDate(p.requiredDate)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Upcoming Deliveries */}
      <div className="overflow-hidden rounded-lg border border-sdc-border bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sdc-border-soft bg-sdc-gray-100 px-4 py-2.5">
          <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-sdc-blue-dark">
            <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded bg-sdc-blue-light text-[11px] font-extrabold text-sdc-blue-dark">→</span>
            Upcoming Deliveries
          </span>
          <div className="flex flex-wrap items-center gap-1">
            {risk.weekData.map((w) => (
              <button
                key={w.week}
                type="button"
                onClick={() => setUpcomingWeek(w.week)}
                className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                  w.week === (selectedWeek?.week ?? 1) ? "bg-sdc-blue text-white" : w.count > 0 ? "bg-sdc-blue-light text-sdc-blue-dark hover:bg-sdc-blue-100" : "text-sdc-gray-400 hover:bg-sdc-gray-100"
                }`}
              >
                {w.week}W{w.count > 0 ? <span className="ml-0.5 opacity-80">({w.count})</span> : null}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-sdc-border" aria-hidden />
            <Stat label="Parts" value={num(selectedParts.length)} />
            <span className="w-3" />
            <Stat label="Suppliers" value={num(upSuppliers)} />
            <span className="w-3" />
            <Stat label="Nearest" value={upNearest ? fmtDate(new Date(upNearest).toISOString()) : "—"} />
            <span className="w-2" />
            <SeeAllBtn onClick={() => setSeeAll("upcoming")} disabled={risk.upcoming.length === 0} />
          </div>
        </div>
        <div className="max-h-44 overflow-y-auto styled-scrollbar">
          {selectedParts.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-sdc-gray-400">No parts with an expected date in week {selectedWeek?.week ?? 1}.</p>
          ) : (
            selectedParts.map((p, i) => <UpcomingRow key={`${p.id}-${i}`} p={p} onClick={() => drillRow(p)} />)
          )}
        </div>
      </div>

      {seeAll && (
        <SidePanel
          title={seeAll === "delivery" ? "Delivery Slip" : seeAll === "nopo" ? "Parts without Purchase Order" : "Upcoming Deliveries"}
          subtitle={
            seeAll === "delivery"
              ? `${risk.delivery.length} parts due this week`
              : seeAll === "nopo"
                ? `${risk.noPo.length} parts need a PO`
                : `${risk.upcoming.length} parts due in the next 8 weeks`
          }
          onClose={() => setSeeAll(null)}
        >
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 z-[1]">
              <tr className="bg-sdc-navy text-[9px] font-bold uppercase tracking-wider text-white">
                {seeAll === "upcoming" && <th className="px-3 py-2 font-bold">PO #</th>}
                <th className="px-3 py-2 font-bold">Part #</th>
                <th className="px-2 py-2 font-bold">Description</th>
                {seeAll !== "nopo" && <th className="px-2 py-2 font-bold">Supplier</th>}
                <th className="px-2 py-2 font-bold">Req</th>
                {seeAll !== "nopo" && <th className="px-2 py-2 font-bold">Exp</th>}
              </tr>
            </thead>
            <tbody>
              {(seeAll === "delivery" ? risk.delivery : seeAll === "nopo" ? risk.noPo : risk.upcoming).map((p, i) => (
                <tr
                  key={`${p.id}-${i}`}
                  onClick={() => { onPartClick(p); setSeeAll(null); }}
                  title="Copy part # · locate row"
                  className={`cursor-pointer border-b border-sdc-border-soft/60 hover:bg-sdc-blue-light/25 ${p.st.key === "overdue" ? "bg-sdc-red-bg/40" : ""}`}
                >
                  {seeAll === "upcoming" && <td className="px-3 py-1.5 font-mono text-[10px] text-sdc-gray-600">{p.poNumber || "—"}</td>}
                  <td className="px-3 py-1.5 font-mono text-[11px] font-semibold text-sdc-blue">{p.pn}</td>
                  <td className="px-2 py-1.5 text-[11px] text-sdc-navy" title={p.desc}><span className="line-clamp-1">{p.desc || "—"}</span></td>
                  {seeAll !== "nopo" && <td className="px-2 py-1.5"><SupplierChip supplier={p.supplier} /></td>}
                  <td className="px-2 py-1.5 whitespace-nowrap font-mono text-[10px] text-sdc-gray-600">{fmtDate(p.requiredDate)}</td>
                  {seeAll !== "nopo" && <td className="px-2 py-1.5 whitespace-nowrap font-mono text-[10px] text-sdc-gray-600">{fmtDate(p.expectedDate)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </SidePanel>
      )}
    </div>
  );
}

function SeeAllBtn({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-sdc-border bg-white px-2 py-1 text-[11px] font-medium text-sdc-navy hover:bg-sdc-blue-light disabled:cursor-not-allowed disabled:opacity-40"
    >
      See all
    </button>
  );
}

function SlipRow({ p, now, onClick }: { p: FlatPart; now: number; onClick: () => void }) {
  const expT = p.expectedDate ? new Date(p.expectedDate).getTime() : NaN;
  const expLate = Number.isFinite(expT) && expT < startOfTodayMs(now);
  return (
    <div
      onClick={onClick}
      title="Copy part # · locate row"
      className="grid cursor-pointer grid-cols-[88px_1fr_100px_58px_58px] items-center gap-2 border-b border-sdc-border-soft/60 px-4 py-1.5 last:border-b-0 hover:bg-sdc-blue-light/30"
    >
      <span className="truncate font-mono text-[11px] font-semibold text-sdc-blue" title={p.pn}>{p.pn}</span>
      <span className="truncate text-[11px] text-sdc-navy" title={p.desc}>{p.desc || "—"}</span>
      <span className="truncate text-[10px] text-sdc-gray-600" title={p.supplier ?? ""}>{p.supplier || "—"}</span>
      <span className="whitespace-nowrap font-mono text-[10px] text-sdc-gray-600">{fmtDate(p.requiredDate)}</span>
      <span className={`whitespace-nowrap font-mono text-[10px] ${expLate ? "font-semibold text-sdc-red-text" : "text-sdc-gray-600"}`}>{fmtDate(p.expectedDate)}</span>
    </div>
  );
}

function UpcomingRow({ p, onClick }: { p: FlatPart; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      title="Copy part # · locate row"
      className="grid cursor-pointer grid-cols-[58px_88px_1fr_100px_58px_58px] items-center gap-2 border-b border-sdc-border-soft/60 px-4 py-1.5 last:border-b-0 hover:bg-sdc-blue-light/30"
    >
      <span className="truncate font-mono text-[10px] text-sdc-gray-600" title={p.poNumber ?? ""}>{p.poNumber || "—"}</span>
      <span className="truncate font-mono text-[11px] font-semibold text-sdc-blue" title={p.pn}>{p.pn}</span>
      <span className="truncate text-[11px] text-sdc-navy" title={p.desc}>{p.desc || "—"}</span>
      <span className="truncate text-[10px] text-sdc-gray-600" title={p.supplier ?? ""}>{p.supplier || "—"}</span>
      <span className="whitespace-nowrap font-mono text-[10px] text-sdc-gray-600">{fmtDate(p.expectedDate)}</span>
      <span className="whitespace-nowrap font-mono text-[10px] text-sdc-gray-600">{fmtDate(p.requiredDate)}</span>
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
