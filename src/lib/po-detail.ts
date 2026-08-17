// ─────────────────────────────────────────────────────────────────────────────
// PO / procurement detail — pure logic shared by the Job Hour Details →
// Procurement drawer (JobProcurement.tsx / PoDetailPanel.tsx) and any other
// caller that needs one PO's detail without a whole BOM page around it (e.g.
// Build Readiness's Upcoming Unlocks, which only has jobId/poNumber/supplier
// and fetches the rest on click via a Server Action).
//
// No "use client", no "server-only" — safe to import from a Server Action
// (build-readiness-po-actions.ts) as well as a client component
// (JobProcurement.tsx), same as hours-filters.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { BomNode, BomPart, JobBom, PoLineGroup, Vendor } from "@/lib/job-bom";
import type { PartsCostLine } from "@/lib/sync-totaleto";
import { normPn, type WindowAttribution } from "@/lib/parts-cost-window-attribution";

// A minimal shape shared by BOM leaf parts (Assemblies detail table) and the
// flattened Parts List rows — enough to drill + copy.
export type DrillablePart = { id: number; pn: string };

export const DAY = 86_400_000;

// ── Status model ─────────────────────────────────────────────────────────────
// One derived status per part (mirrors the Scheduler's _procPartStatus). Time-
// relative keys (overdue/soon) resolve against a `now` passed by the caller.
//
// `stock` and `process` exist because a requirement with no purchase order is
// not automatically a procurement gap: it can be coming out of inventory or
// being built in-house on an ETO process schedule. Those used to fall through
// to "NO PO" (red) or "ON ORDER" (blue, with no PO to point at) — both wrong.
// `noPO` is now only what job-bom-rules.ts calls genuinely uncovered.
export type StatusKey = "received" | "hold" | "noPO" | "overdue" | "soon" | "ordered" | "stock" | "process";
export type PartStatus = { key: StatusKey; label: string; cls: string; sub: string };

export function partStatus(
  p: { status: BomPart["status"]; source?: BomPart["source"]; hold: boolean; expectedDate: string | null; requiredDate: string | null; poId?: string | null; poNumber?: string | null },
  now: number,
): PartStatus {
  if (p.status === "received") return { key: "received", label: "RECEIVED", cls: "received", sub: "" };
  if (p.hold) return { key: "hold", label: "ON HOLD", cls: "hold", sub: "in ETO" };
  if (p.status === "noPO") return { key: "noPO", label: "NO PO", cls: "noPO", sub: "" };
  if (p.source === "stock") return { key: "stock", label: "FROM STOCK", cls: "stock", sub: "inventory pull" };
  if (p.source === "process") return { key: "process", label: "IN PROCESS", cls: "process", sub: "built in-house" };
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

export const STATUS_PILL: Record<StatusKey, string> = {
  received: "bg-sdc-green-bg text-sdc-green-text",
  ordered: "bg-sdc-blue-light text-sdc-blue-dark",
  soon: "bg-sdc-yellow-bg text-sdc-yellow-text",
  overdue: "bg-sdc-red-bg text-sdc-red-text",
  noPO: "border border-sdc-red-border bg-white text-sdc-red-text",
  hold: "bg-sdc-gray-100 text-sdc-gray-600",
  // Covered, just not by a purchase order — read as progress, not as a gap.
  stock: "bg-sdc-green-bg/70 text-sdc-green-text",
  process: "bg-sdc-blue-light text-sdc-blue-dark",
};

// Light row tint per status — same hues as the status pills, applied to the
// whole Parts-List row so status reads at a glance (with a slightly stronger
// tint on hover). The drill-flash (inline style) still wins over these.
export const STATUS_ROW_BG: Record<StatusKey, string> = {
  received: "bg-sdc-green-bg/90 hover:bg-sdc-green-bg",
  ordered: "bg-sdc-blue-light/75 hover:bg-sdc-blue-light/95",
  soon: "bg-sdc-yellow-bg/90 hover:bg-sdc-yellow-bg",
  overdue: "bg-sdc-red-bg/90 hover:bg-sdc-red-bg",
  noPO: "bg-sdc-red-bg/45 hover:bg-sdc-red-bg/80",
  hold: "bg-sdc-gray-100 hover:bg-sdc-gray-100",
  stock: "bg-sdc-green-bg/50 hover:bg-sdc-green-bg/80",
  process: "bg-sdc-blue-light/60 hover:bg-sdc-blue-light/90",
};

export const COST_BASIS_NOTE: Record<BomPart["costBasis"], string> = {
  po: "This job's purchase order price",
  pull: "Inventory pull price — issued from stock, no PO",
  bom: "Cost entered on the BOM line",
  lastCost: "Last purchased price (LPP) from the item master — no PO on this job",
  listCost: "List price from the item master — no PO and no purchase history",
  none: "No price on the PO, the BOM line or the item master",
};

// True where the price came from something other than a committed PO line, so
// the cell can mark itself as an estimate.
export const isEstimatedCost = (b: BomPart["costBasis"]) => b !== "po" && b !== "none";

export function num(n: number): string {
  return (Math.round(n) || 0).toLocaleString();
}

// Compact date — "Dec 14". Formats a passed ISO string only. "—" for empty/bad.
export function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Days between two ISO dates (b − a), or null if either is missing/invalid.
export function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.round((db - da) / DAY);
}

// PM-facing section (spec) label overrides — DISPLAY ONLY, keyed by SpecID.
// Matches the Scheduler's SECTION_LABEL_OVERRIDE so both apps read the same.
export const SECTION_LABEL_OVERRIDE: Record<number, string> = {
  10: "Mechanical Design and Build",
  30: "Control-Related Parts",
  40: "Machine Testing-Related Parts",
  90: "Spare Parts",
};

export function sectionLabelFor(section: BomNode): string {
  const specId = typeof section.id === "string" ? Number(section.id.replace(/\D/g, "")) : Number(section.id);
  const title = SECTION_LABEL_OVERRIDE[specId] ?? section.desc ?? "";
  return `Section ${specId}${title ? ` — ${title}` : ""}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Flatten + join
// ─────────────────────────────────────────────────────────────────────────────

// A BOM leaf part enriched with its parent assembly + the joined PO purchase
// line (category / purchased / invoiced / PO#) and derived lead/due.
export type FlatPart = BomPart & {
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
  // Power BI "Parts Cost" money fields — from the matched PartsCostLine.
  totalPrice: number; // line totalPrice (fallback unitPrice * qty), always lifetime
  invoicedAmount: number; // lifetime, OR window-scoped when an Invoiced+range window is active
  // null when a window is active: totalPrice stays lifetime while invoicedAmount
  // becomes window-scoped, so "% of lifetime committed value invoiced THIS
  // window" and "lifetime committed minus this window's invoiced slice" are
  // both numbers with no coherent business meaning — not shown rather than
  // silently mixing a monthly figure with a lifetime one (the exact
  // anti-pattern sync-totaleto.ts's own comments repeatedly call out).
  pctInvoiced: number | null; // round(invoiced / total * 100)
  leftToSpend: number | null; // totalPrice - invoicedAmount
};

// The Parts List "Parent Assembly" cell's own text, shared with its sort
// accessor (partsListSortColumns in PoDetailPanel.tsx) so the two can never
// disagree about what a parentless part reads as.
export function parentLineFor(p: FlatPart): string {
  return p.parentPN ? `${p.parentPN}${p.parentDesc ? ` — ${p.parentDesc}` : ""}` : "Loose parts";
}

// Every BOM leaf part flattened + enriched + deduped by part id, so this is a
// true procurement buy-list (each physical part once) — the source for the
// Parts List table, the two summary cards, the top readiness line, and any
// other caller (e.g. a Server Action) that needs one job's full buy-list
// without rendering it.
//
// `activeAttribution` mirrors JobProcurement's own Invoiced+range window
// feature: null (the default) means every figure is lifetime, which is what
// every caller other than JobProcurement.tsx itself wants.
export function flattenBomParts(bom: JobBom, partsLines: PartsCostLine[], activeAttribution: WindowAttribution | null = null): FlatPart[] {
  const lineIndex = new Map<string, PartsCostLine[]>();
  for (const l of partsLines ?? []) {
    const key = normPn(l.partNumber);
    if (!key) continue;
    const arr = lineIndex.get(key);
    if (arr) arr.push(l);
    else lineIndex.set(key, [l]);
  }
  for (const arr of lineIndex.values()) {
    arr.sort((a, b) => (b.purchaseDate ?? "").localeCompare(a.purchaseDate ?? ""));
  }

  const out: FlatPart[] = [];
  const seen = new Set<number>();
  const now = Date.now();

  const enrich = (p: BomPart, parentPN: string, parentDesc: string, sectionId: string, sectionLabel: string) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    const line = lineIndex.get(normPn(p.pn))?.[0] ?? null;
    const supplier = p.supplier ?? line?.supplier ?? null;
    const totalPrice = line?.totalPrice ?? p.unitPrice * p.qty;

    // Lifetime by default. When an Invoiced+range window is active AND
    // resolved, invoicedAmount becomes exactly what was invoiced against THIS
    // part's number within that window (attributeInvoicedWindow already
    // summed across every PO line the part has ever had, not just the newest
    // one lineIndex shows), and pctInvoiced/leftToSpend become null rather
    // than mixing a windowed figure with totalPrice's lifetime one.
    const windowedInvoiced = activeAttribution?.byPartNumber.get(normPn(p.pn));
    const invoicedAmount = activeAttribution ? (windowedInvoiced ?? 0) : (line?.invoicedAmount ?? 0);
    const pctInvoiced = activeAttribution
      ? null
      : totalPrice > 0
        ? Math.round((invoicedAmount / totalPrice) * 100)
        : invoicedAmount > 0
          ? 100
          : 0;
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
      supplier,
      leadDays: daysBetween(line?.purchaseDate ?? null, p.expectedDate),
      st: partStatus(p, now),
      totalPrice,
      invoicedAmount,
      pctInvoiced,
      leftToSpend: activeAttribution ? null : totalPrice - invoicedAmount,
    };
    out.push(flat);
  };

  const walk = (node: BomNode, sectionId: string, sectionLabel: string) => {
    // A "Both Assembly and Contents" assembly is itself one of the things to
    // buy (job-bom-rules.ts: BomNode.self). It belongs in the buy-list next to
    // the loose parts, not only in the tree.
    if (node.self) enrich(node.self, node.pn, node.desc, sectionId, sectionLabel);
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
}

// ─────────────────────────────────────────────────────────────────────────────
// PO grouping
// ─────────────────────────────────────────────────────────────────────────────

export const NO_PO_KEY = "__NO_PO__";

export type PoGroup = {
  poKey: string;
  poNumber: string | null;
  parts: FlatPart[];
  received: number;
  total: number;
  expected: string | null; // soonest expected date among the PO's parts
  status: "received" | "ordered" | "noPO";
  pastDue: boolean;
};

// Build one PO's group (received/expected/status rollup) from the parts
// sharing a supplier + PO key. Shared by the Card view and the table/assembly
// PO-panel.
export function makePoGroup(poKey: string, poParts: FlatPart[]): PoGroup {
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

// Matches a real PO ("PO 1234") against a bare int and a zero-padded string
// alike (TotalETO's own inconsistency, not the Scheduler's parseInt-based
// match). Returns undefined when there's no match, which is the signal to
// keep the BOM-derived counts.
export function findAuthoritativePo(vendors: Vendor[] | undefined, poNumber: string | null): PoLineGroup | undefined {
  if (!vendors?.length || !poNumber) return undefined;
  const target = parseInt(poNumber, 10);
  for (const v of vendors) {
    for (const po of v.pos) {
      if (po.poId === poNumber) return po;
      const a = parseInt(po.poId, 10);
      if (!Number.isNaN(a) && !Number.isNaN(target) && a === target) return po;
    }
  }
  return undefined;
}

// Authoritative supplier rollup (received / itemCount across all the
// supplier's POs), matched by vendor name. Undefined when the supplier has no
// PO data.
export function authoritativeVendorRollup(vendors: Vendor[] | undefined, supplier: string): { received: number; itemCount: number; pct: number } | undefined {
  if (!vendors?.length) return undefined;
  const key = supplier.trim().toLowerCase();
  const v = vendors.find((x) => x.name.trim().toLowerCase() === key);
  if (!v) return undefined;
  let received = 0;
  let itemCount = 0;
  for (const po of v.pos) {
    received += po.received;
    itemCount += po.itemCount;
  }
  if (itemCount === 0) return undefined;
  return { received, itemCount, pct: Math.round((received / itemCount) * 100) };
}
