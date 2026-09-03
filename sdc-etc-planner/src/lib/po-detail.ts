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
import { alternateKeys, classifyUnmatched, type MatchReason } from "@/lib/parts-match-reason";
import { normalizeVendor } from "@/lib/vendor-normalize";
import { isUncoveredPart } from "@/lib/job-bom-rules";

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

// ── What the PO COLUMN shows for one part (2026-08-28) ──────────────────────
//
// A separate question from `partStatus` above (which answers "how is this
// requirement doing"), and it needs its own rule because the PO cell was
// deriving one inline — and getting it wrong in BOTH directions.
//
// What the cell used to do, in three places:
//
//     poId ? <link> : source === "stock" ? STOCK
//                   : source === "process" ? PROCESS
//                   : <red NO PO>
//
// That is the raw "po_number is blank" definition, not the actionable one, so:
//
//   OVER-LABELLED  Every held part and every already-received part with no PO
//                  painted red. Measured live: job 6000 showed 65 red rows
//                  against 0 actionable; 1148 showed 59 against 0; 1154 32
//                  against 0; 1129 91 against 24. All of the extras were
//                  exactly `hold` or `received`.
//   UNDER-LABELLED The reverse, and the more dangerous one: a part whose PO row
//                  exists but carries POQty 0 or -1 covers nothing, so
//                  `sourceFor` correctly calls it uncovered — but the cell saw
//                  a poId and rendered a PO link, hiding a real gap. Live
//                  examples: 1147 PO 104393 (qty 0), 1143 PO 103689 (qty -1),
//                  1162 PO 106098 (qty 0).
//
// So the red state is now decided by `isUncoveredPart` — the SAME rule the No
// Purchase Order card, the readiness line and the Parts List filter count with
// — and it is checked FIRST, so a stale zero-quantity PO cannot mask a gap.
// Everything else with a blank PO gets a truthful non-red state instead.
export type PoCellState =
  | { kind: "po"; po: string }
  /** Covered by an inventory pull — legitimately needs no PO. */
  | { kind: "stock" }
  /** Built in-house on an ETO process schedule — legitimately needs no PO. */
  | { kind: "process" }
  /** Already satisfied. Whatever route it arrived by, there is nothing to raise. */
  | { kind: "received" }
  /** Paused in ETO. Chasing a PO for something on hold is not an action. */
  | { kind: "hold" }
  /** A genuine, actionable purchasing gap. `stalePo` is a PO that exists but covers no quantity. */
  | { kind: "none"; stalePo: string | null };

export function poCellState(
  p: Pick<BomPart, "status" | "hold" | "source"> & { poId?: string | null; poNumber?: string | null },
): PoCellState {
  // FIRST, so a PO row that covers nothing cannot present as covered.
  if (isUncoveredPart(p)) return { kind: "none", stalePo: p.poNumber ?? p.poId ?? null };
  const po = p.poId ?? p.poNumber;
  if (po) return { kind: "po", po: String(po) };
  if (p.source === "stock") return { kind: "stock" };
  if (p.source === "process") return { kind: "process" };
  if (p.status === "received") return { kind: "received" };
  // Held AND uncovered already returned "none"? No — isUncoveredPart excludes
  // held parts on purpose, so a held part with no PO lands here and reads as
  // paused rather than as a gap somebody should act on.
  if (p.hold) return { kind: "hold" };
  return { kind: "received" };
}

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
// The section a non-BOM row belongs to. A real section id is Total ETO's own
// SpecID, so this string cannot collide with one, and the grouping and filter code
// that reads sectionId keeps working with no special case.
export const NON_BOM_SECTION_ID = "__NON_BOM__";

// Non-BOM rows carry no delivery state: there is no BOM part to be waiting for, so
// a "received" or "late" reading would be an invention. `noPO` is the existing key
// for "nothing to track here".
const NON_BOM_STATUS: PartStatus = { key: "noPO", label: "Not on BOM", sub: "", cls: "text-sdc-muted" };

export type FlatPart = BomPart & {
  /**
   * Why this row exists: "matched" for a BOM part, a `join-*` reason for one the
   * corrected join recovered, or the classification of a purchase line that has no
   * BOM row at all. Every purchase line on the job now reaches the table under one
   * of these, so no money is reported only as a footer summary (2026-09-02).
   */
  matchReason: MatchReason;
  /** True for a synthesized row standing for purchase lines with no BOM part. */
  nonBom: boolean;
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

  // ── Recovering lines the exact-key join misses (2026-09-02) ───────────────
  //
  // normPn only folds case and whitespace, so an upstream part number that differs
  // by punctuation, a job suffix or leading zeros lands on no BOM row and its money
  // was reported as "non-BOM". Measured on job 1101: 4 lines, $635, for a part the
  // BOM does carry.
  //
  // Every alternate is a deterministic transform of a BOM part's OWN number and is
  // only accepted when it resolves to a part number the BOM already has, so this
  // recovers spellings of the same part — it never invents a match between two
  // genuinely different numbers. First writer wins, so a BOM part's exact key can
  // never be displaced by another part's looser one.
  const altLookup = new Map<string, PartsCostLine[]>();
  for (const [key, lines] of lineIndex) {
    for (const alt of alternateKeys(key)) {
      if (!altLookup.has(alt.key)) altLookup.set(alt.key, lines);
    }
  }
  const usedLines = new Set<PartsCostLine>();
  // Lines taken by a RECOVERY specifically. An exact-key claim is unconditional
  // (two BOM rows sharing a part number are both entitled to it, and `shareOf`
  // splits it) — but it must not re-take a line that an earlier part already
  // recovered under a looser spelling, or the same line is counted twice.
  //
  // This is order-dependent and that is the whole point: measured on 11 active
  // jobs, 1104 over-counted by $8 and 1125 by $169, in both cases a part whose
  // alternate spelling was recovered BEFORE the part holding the exact key was
  // reached. Nine other jobs reconciled to the cent, which is exactly why a guard
  // that reports the difference beats one that absorbs it.
  const altClaimed = new Set<PartsCostLine>();
  for (const arr of lineIndex.values()) {
    arr.sort((a, b) => (b.purchaseDate ?? "").localeCompare(a.purchaseDate ?? ""));
  }

  const out: FlatPart[] = [];
  const seen = new Set<number>();
  const now = Date.now();

  const sumLines = (lines: PartsCostLine[], f: (l: PartsCostLine) => number) => {
    let total = 0;
    for (const l of lines) total += f(l);
    return total;
  };

  // ── How many BOM rows share a part number ─────────────────────────────────
  //
  // Summing a part's whole PO history onto its row is right when the part has ONE
  // row. When the same part number appears on two BOM rows, both would claim the
  // full amount and the table would over-count — trading an under-count for an
  // over-count, which is not an improvement.
  //
  // So the part's money is divided evenly across the rows carrying it, and the
  // column still sums to exactly what the job spent on that part. Measured on job
  // 1101: 529 BOM rows, 528 distinct part numbers — exactly one part repeats, so
  // this divisor is 1 for 527 of them. It exists for correctness, not because it
  // is load-bearing on any job seen so far.
  //
  // A pre-pass rather than a post-pass over `out`, so `enrich` stays a single
  // expression per field and there is no second place where a row's money can be
  // rewritten after the fact.
  const shareCount = new Map<string, number>();
  {
    const counted = new Set<number>();
    const countPart = (part: BomPart) => {
      if (counted.has(part.id)) return;
      counted.add(part.id);
      const key = normPn(part.pn);
      if (key) shareCount.set(key, (shareCount.get(key) ?? 0) + 1);
    };
    const countNode = (node: BomNode) => {
      if (node.self) countPart(node.self);
      for (const part of node.parts) countPart(part);
      for (const child of node.children) countNode(child);
    };
    for (const section of bom.roots) {
      for (const part of section.parts) countPart(part);
      for (const child of section.children) countNode(child);
    }
  }
  const shareOf = (pn: string) => shareCount.get(normPn(pn)) || 1;

  const enrich = (p: BomPart, parentPN: string, parentDesc: string, sectionId: string, sectionLabel: string) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    // ── Exact lines AND differently-spelled ones, together ──────────────────
    //
    // The first version of this only tried the looser keys when the exact one
    // missed entirely, and that is not the shape the problem takes. Job 1101 has a
    // BOM part `MASTN20_325` (underscore) with purchase lines under BOTH
    // `MASTN20_325` and `MASTN20-325` (hyphen): the exact key hit, so recovery
    // never ran, and the hyphen lines stayed orphaned in the non-BOM bucket while
    // the part they belong to sat right there showing a smaller cost.
    //
    // So every spelling is collected, not just the first that resolves. Deduped by
    // line identity, and `usedLines` makes the claim exclusive — the first BOM part
    // to reach a line owns it, so two parts whose numbers collapse to the same
    // loose key cannot both count it.
    // The exact key is claimed UNCONDITIONALLY, `usedLines` notwithstanding: two BOM
    // rows carrying the same part number are both entitled to it, and `shareOf`
    // below is what stops that being a double-count. Skipping an already-claimed
    // line here instead left the second row with nothing while the first still
    // divided its money in two — half the part's cost simply disappearing. Measured
    // on job 1101 as $566 the footer's own guard then reported as unaccounted,
    // which is exactly the job that guard exists to do.
    // ── Exact and recovered lines are divided DIFFERENTLY ───────────────────
    //
    // `shareOf` exists because two BOM rows carrying the same part number are both
    // entitled to that part's exact lines, so each takes a share. Recovered lines
    // are not like that: a differently-spelled line is claimed by exactly ONE row
    // (`usedLines`), so dividing it by a share sends the rest of it nowhere.
    //
    // Measured across 11 active jobs after the first version: 9 reconciled to the
    // cent and 2 did not — 1104 short by $8, 1125 by $169 — and both were jobs
    // where recovery had fired on a part that also shares its number with another
    // BOM row. Same defect twice, found only because the footer's guard reports the
    // difference instead of absorbing it.
    const exactLines = (lineIndex.get(normPn(p.pn)) ?? []).filter((l) => !altClaimed.has(l));
    const altLines: PartsCostLine[] = [];
    let recovered: MatchReason | null = null;
    for (const alt of alternateKeys(p.pn)) {
      const hit = altLookup.get(alt.key);
      if (!hit) continue;
      for (const l of hit) {
        if (usedLines.has(l) || exactLines.includes(l) || altLines.includes(l)) continue;
        altLines.push(l);
        altClaimed.add(l);
        recovered = recovered ?? alt.reason;
      }
    }
    const collected = [...exactLines, ...altLines];
    const pnLines = collected.length > 0 ? collected : null;
    /** Exact lines take a share; recovered lines belong wholly to this row. */
    const splitSum = (f: (l: PartsCostLine) => number) =>
      sumLines(exactLines, f) / shareOf(p.pn) + sumLines(altLines, f);
    // "no-purchase", not "non-bom": a row with no line IS a BOM part, it just has
    // nothing bought against it yet, so its money below is the BOM's own estimate
    // rather than spend. Conflating the two put estimate money into a total meant
    // to reconcile against purchase lines — job 1101, $3,630 of stock and
    // not-yet-ordered parts inflating a figure compared against actual PO spend.
    const matchReason: MatchReason = !pnLines ? "no-purchase" : (recovered ?? "matched");
    if (pnLines) for (const l of pnLines) usedLines.add(l);
    const line = pnLines?.[0] ?? null;
    // ── Vendor names normalized here, once (2026-09-03) ────────────────────
    //
    // This is the single point every Parts List consumer reads through — the table,
    // the supplier/manufacturer filter options, the search haystack, the sort, the
    // card view and the export all take their vendor strings from FlatPart. So
    // normalizing here is what makes the filter list agree with the table, which was
    // the reported bug: SDC appeared under several names and picking one option
    // returned a subset of the job's SDC parts.
    //
    // lib/vendor-normalize.ts holds the mapping and the two lookalikes it refuses to
    // merge. The RAW value is untouched on the underlying PartsCostLine, so anything
    // reconciling against Total ETO still can.
    const supplier = normalizeVendor(p.supplier ?? line?.supplier ?? null);
    // ── EVERY PO line for this part, not just the newest (2026-09-02) ────────
    //
    // This read `line.totalPrice` — the single newest PO line — as the part's cost.
    // Measured on job 1101: 2,132 PO lines across 579 part numbers, so 1,553 lines
    // (73%) belonged to a part's earlier POs and were represented nowhere. The
    // footer read Invoiced $290,266 against the Parts Cost card's $730,483 for the
    // same job, and the difference was not scope or filtering — it was money the
    // table simply never looked at.
    //
    // A part bought three times has cost the job all three, so the money columns sum
    // every line the part has. `line` is still the newest and still supplies the
    // DISPLAY fields (PO #, supplier, dates, category): those are properties of a
    // purchase, not of the part, and the newest is the useful one to show.
    const totalPrice = pnLines ? splitSum((l) => l.totalPrice) : p.unitPrice * p.qty;

    // Lifetime by default. When an Invoiced+range window is active AND
    // resolved, invoicedAmount becomes exactly what was invoiced against THIS
    // part's number within that window (attributeInvoicedWindow already
    // summed across every PO line the part has ever had, not just the newest
    // one lineIndex shows), and pctInvoiced/leftToSpend become null rather
    // than mixing a windowed figure with totalPrice's lifetime one.
    const windowedInvoiced = activeAttribution?.byPartNumber.get(normPn(p.pn));
    // Same change on the invoiced side, and note WHICH field: `actualAmount`, the
    // GL-posted slice — the app's one definition of Parts Actual, and the field
    // getPartsCostFinancials sums for the card. This used `invoicedAmount` (billed,
    // including documents flagged never-to-export), which on 1101 is $749,981
    // against a GL-posted $730,483. Two of this table's columns were therefore
    // measured on a different basis from the card they sit beside.
    //
    // The windowed figure is already summed across every line by
    // attributeInvoicedWindow, so it only needs the same share division.
    const invoicedAmount = activeAttribution
      ? (windowedInvoiced ?? 0) / shareOf(p.pn)
      : pnLines
        ? splitSum((l) => l.actualAmount)
        : 0;
    const pctInvoiced = activeAttribution
      ? null
      : totalPrice > 0
        ? Math.round((invoicedAmount / totalPrice) * 100)
        : invoicedAmount > 0
          ? 100
          : 0;
    const flat: FlatPart = {
      ...p,
      // After the spread, so it overrides the BomPart's raw value.
      // `?? ""` keeps BomPart's non-nullable `manufacturer: string` contract — a blank
      // stays blank rather than becoming null, which is what every consumer of a BOM
      // row already expects.
      manufacturer: normalizeVendor(p.manufacturer) ?? "",
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
      matchReason,
      nonBom: false,
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

  // ── Every remaining purchase line becomes a real row (2026-09-02) ─────────
  //
  // These are the lines no BOM part claimed. They used to reach the screen only as a
  // footer sentence — "$88,643 sits on 90 part numbers with no BOM row" — which is
  // an assertion the reader cannot check and cannot act on. Measured on job 1101
  // that sentence stood for 471 purchase lines: freight, tariffs, outside processes,
  // supplier fees, expense reimbursements, discounts, and parts bought against a
  // superseded revision. Each is now a row, carrying its own classified reason.
  //
  // Grouped by part number so the table reads as one row per thing bought rather
  // than 180 identical "Shipping" lines — the same grain the BOM rows use, and the
  // money is the same either way. `usedLines` is what keeps this disjoint from the
  // matched set: a line consumed by a BOM row (including one recovered by the
  // corrected join) can never also appear here, so matched ∩ non-BOM is empty by
  // construction rather than by a later reconciliation step.
  const leftovers = new Map<string, PartsCostLine[]>();
  for (const l of partsLines ?? []) {
    if (usedLines.has(l)) continue;
    const key = normPn(l.partNumber) || `\u0000blank:${normPn(l.description) || "(none)"}`;
    const arr = leftovers.get(key);
    if (arr) arr.push(l);
    else leftovers.set(key, [l]);
  }

  let syntheticId = -1;
  for (const [, lines] of leftovers) {
    const first = lines[0];
    const totalPrice = sumLines(lines, (l) => l.totalPrice);
    const invoicedAmount = activeAttribution
      ? (activeAttribution.byPartNumber.get(normPn(first.partNumber)) ?? 0)
      : sumLines(lines, (l) => l.actualAmount);
    const reason = classifyUnmatched(first.partNumber, first.description, totalPrice, null);
    out.push({
      // Negative synthetic ids: BomPart ids are Total ETO's own positive keys, so
      // these cannot collide with a real part, and anything keyed on id (the drill
      // target, the row key) keeps working without a special case.
      id: syntheticId--,
      pn: first.partNumber ?? "",
      desc: first.description ?? "",
      qty: lines.reduce((s2, l) => s2 + l.quantity, 0),
      unitPrice: first.unitPrice,
      supplier: normalizeVendor(first.supplier),
      manufacturer: normalizeVendor(first.manufacturer),
      poId: first.poNumber,
      expectedDate: null,
      requiredDate: null,
      receivedDate: null,
      parentPN: "",
      parentDesc: "",
      sectionId: NON_BOM_SECTION_ID,
      sectionLabel: "Not on the BOM",
      category: first.category,
      purchasedDate: first.purchaseDate,
      invoicedDate: first.invoicedDate,
      poNumber: first.poNumber,
      leadDays: null,
      st: NON_BOM_STATUS,
      totalPrice,
      invoicedAmount,
      pctInvoiced: activeAttribution ? null : totalPrice > 0 ? Math.round((invoicedAmount / totalPrice) * 100) : invoicedAmount > 0 ? 100 : 0,
      leftToSpend: activeAttribution ? null : totalPrice - invoicedAmount,
      matchReason: reason,
      nonBom: true,
    } as FlatPart);
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
