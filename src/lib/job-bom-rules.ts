// Procurement BOM rules — the no-I/O half of `job-bom.ts`.
//
// Everything here is a pure function over already-fetched Total ETO rows, so the
// rules that decide *what a project actually has to buy* can be unit-tested
// without a database. `job-bom.ts` owns the SQL and calls into this module.
//
// ── Why this module exists ───────────────────────────────────────────────────
// The first version of the procurement BOM exploded tblEngProductStructure all
// the way to its leaves and treated every leaf as a thing to buy, with "has a
// PO" as the only notion of coverage. Both halves of that are wrong against how
// Total ETO is actually used, and against the SDC Standard Project BOM report
// (Structured BOM - Readiness Summary) that Purchasing reconciles to:
//
//  1. BOM RELEASE STATUS decides whether an assembly is purchased as one item
//     or exploded into its contents. `tblEngProductStructure.BOMAssemblyReleaseID`
//     carries it PER EDGE (parent→child), keyed to tsysBOMAssemblyRelease:
//       1 = Contents of Assembly Only   — the parent is not bought; its contents are
//       2 = Assembly Only               — the parent IS the bought item; contents are NOT
//       3 = Both Assembly and Contents  — the parent AND its contents are bought
//     Job 1116's `1116-DB-000` (LEFT PICK CONVEYOR) is Assembly Only: it is one
//     $1,430 purchase on PO 101563, and the reference report shows exactly that
//     one line — not the CONVEYOR FOOT / DRIVE ASSY / EXIT RAIL parts beneath it.
//     Exploding it double-counted the requirement (parent price AND children) and
//     dragged readiness down with sub-parts nobody will ever raise a PO for.
//
//  2. NO PO IS NOT THE SAME AS MISSING. A part can legitimately have no purchase
//     order because it was pulled from inventory (tblInventoryPullDetails), it is
//     made in-house on an ETO process schedule (tblProcessScheduleHeader), or it
//     sits inside an Assembly-Only parent that was bought whole (rule 1 removes
//     those from the requirement list entirely). Only a part with none of that
//     is a real procurement gap.
//
//  3. A no-PO part still has a COST. Total ETO carries ItemLastCost (LPP / last
//     purchased price) and ItemListCost on the item master, PullPrice on the
//     inventory issue, and ItemCost on the BOM line. Pricing solely off this
//     job's own PO lines understated material cost for every stock/in-house part.
//
// NULL release status → "Contents of Assembly Only". That is Total ETO's own
// default (the value is only ever written for an assembly edge; all 934 of job
// 1116's NULLs are leaf edges, where it is meaningless) and it is also the
// behaviour this module had before release status was read at all, so a project
// that never set the field is unaffected by this change.
//
// Deliberately NOT a coverage signal: ItemLastCost. A price on the item master
// says a part was bought once, somewhere, at some time — it says nothing about
// whether THIS job has it. Job 1116 has 61 no-PO parts with a last cost; the
// reference report shows the SDC-made ones (1116-DAE-001 PIN, 1116-DAE-002 TEACH
// PIN PLATE) as 0% red, i.e. genuinely missing. Last cost prices a requirement;
// it never satisfies one.

export type ReleaseStatus =
  | "contentsOnly" // 1 — explode into contents; the parent is not a buy
  | "assemblyOnly" // 2 — buy the parent whole; contents are not a buy
  | "bothAssemblyAndContents"; // 3 — buy the parent AND explode into contents

// Where a requirement's coverage comes from. "none" is the only real gap.
export type PartSource =
  | "po" // a purchase order exists on this job for this item
  | "stock" // issued/reserved out of inventory (tblInventoryPullDetails)
  | "process" // built in-house on an ETO process schedule
  | "none";

// Which field a unit price came from, so the UI can disclose a figure that is
// not an actual committed PO price.
export type CostBasis = "po" | "pull" | "bom" | "lastCost" | "listCost" | "none";

export type BomStats = {
  total: number; // unique procurement requirements
  received: number; // fully in hand (PO receipts and/or fulfilled inventory pulls)
  noPO: number; // genuine gaps: no PO, no stock pull, no process schedule
  ordered: number; // committed but not yet fully in hand
  stock: number; // covered by inventory/process rather than a PO (informational)
  pct: number;
};

export type BomPart = {
  id: number;
  pn: string;
  desc: string;
  manufacturer: string;
  qty: number;
  poQty: number;
  receivedQty: number; // PO receipts + fulfilled inventory pulls
  unitPrice: number;
  costBasis: CostBasis;
  source: PartSource;
  release: ReleaseStatus; // this edge's release status
  isAssembly: boolean; // a bought assembly (release 2 or 3), not a leaf part
  pullQty: number; // inventory pull quantity against this job
  requiredDate: string | null; // eps.RequiredDate — when the part is needed
  expectedDate: string | null; // current due date (DateRequired || PurchaseDateRequired)
  // The two halves of `expectedDate`, carried separately so the parts table can
  // show a slipped date next to the one originally promised. Total ETO has no
  // explicit "revised" field: the PO HEADER's PurchaseDateRequired is the date
  // set when the order was raised, and the LINE's DateRequired is what that line
  // is currently due. When the line date has moved off the header date, that
  // movement is the revision.
  originalDate: string | null; // poh.PurchaseDateRequired — as ordered
  revisedDate: string | null; // pod.DateRequired, only when it differs
  poDate: string | null; // poh.PurchaseDate — when the PO was raised
  receivedDate: string | null; // LastReceivedDate, or the inventory fulfilment date
  status: "received" | "ordered" | "noPO";
  hold: boolean; // eps.ItemHold — flagged on hold in Total ETO
  supplier: string | null;
  poId: string | null;
};

export type BomNode = {
  key: string; // unique instance key (parent path)
  id: number | string;
  depth: number; // section = 0, its top-level assemblies = 1, …
  label: string;
  pn: string; // part/company number (chip)
  desc: string; // description (name)
  isAssembly: boolean;
  release: ReleaseStatus;
  // The assembly's OWN procurement line, set only for "Both Assembly and
  // Contents" — the one release status where a parent is both a thing to buy and
  // a thing to explode. Null for "Contents of Assembly Only" (parent is not a
  // buy) and for sections. "Assembly Only" parents never become nodes at all;
  // they appear as a BomPart under their own parent.
  self: BomPart | null;
  children: BomNode[]; // nested sub-assemblies
  parts: BomPart[]; // direct leaf parts
  stats: BomStats;
  totalCost: number; // Σ unitPrice × qty over descendant requirements
  totalPartQty: number; // Σ qty over descendant requirements
  nestedAssemblies: number; // count of descendant assemblies
};

// ── Row shapes (what job-bom.ts's SQL returns) ───────────────────────────────

export type BomRow = {
  ChildID: number;
  ChildPN: string | null;
  ChildDesc: string | null;
  Manufacturer: string | null;
  ParentID: number;
  ParentPN: string | null;
  ParentDesc: string | null;
  ItemQty: number | null;
  SpecID: number;
  RequiredDate: Date | null;
  ItemHold: boolean | number | null;
  BOMAssemblyReleaseID: number | null;
  ItemCost: number | null; // eps.ItemCost — cost entered on the BOM line
  ItemLastCost: number | null; // item master LPP / last purchased price
  ItemListCost: number | null;
  POQty: number | null;
  ReceivedQty: number | null;
  UnitPrice: number | null;
  LastReceivedDate: Date | null;
};

// Per-item inventory-pull rollup for one job (tblInventoryPullDetails).
export type PullInfo = {
  pullQty: number; // positive pulls only — negative rows are returns to stock
  fulfilledQty: number;
  pullPrice: number;
  fulfilledDate: Date | null;
};

export type PoLine = {
  poId: string | null;
  supplier: string | null;
  dueDate: string | null;
  orderedDate: string | null;
  originalDate: string | null;
  revisedDate: string | null;
};

// Everything the rules need that isn't on the BOM row itself.
export type BomContext = {
  poIndex: Map<number, PoLine[]>;
  pulls: Map<number, PullInfo>;
  processItems: Set<number>; // ItemIDs with an active ETO process schedule on this job
};

// ── Helpers ──────────────────────────────────────────────────────────────────

export const iso = (d: Date | null | undefined): string | null => {
  if (!d) return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
};

export const clean = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

const RELEASE_BY_ID: Record<number, ReleaseStatus> = {
  1: "contentsOnly",
  2: "assemblyOnly",
  3: "bothAssemblyAndContents",
};

export function releaseOf(r: Pick<BomRow, "BOMAssemblyReleaseID">): ReleaseStatus {
  return RELEASE_BY_ID[Number(r.BOMAssemblyReleaseID)] ?? "contentsOnly";
}

// ── Tree shape ───────────────────────────────────────────────────────────────

export type SpecTree = {
  // Every ItemID that appears as a ParentID — i.e. every item that HAS contents.
  // Structural only: whether those contents get exploded is the release status's
  // call, not this set's.
  assemblyIds: Set<number>;
  childrenMap: Map<number, BomRow[]>;
  deduped: BomRow[];
};

export function buildSpecTree(rows: BomRow[]): SpecTree {
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    const k = `${r.ChildID}-${r.ParentID}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const assemblyIds = new Set<number>(deduped.map((r) => r.ParentID));
  const childrenMap = new Map<number, BomRow[]>();
  for (const r of deduped) {
    const arr = childrenMap.get(r.ParentID);
    if (arr) arr.push(r);
    else childrenMap.set(r.ParentID, [r]);
  }
  return { assemblyIds, childrenMap, deduped };
}

// Does this edge's child get exploded into its contents?
// Assembly Only is the whole point of this function: the parent is the purchase,
// so its contents are not requirements and must not appear anywhere downstream.
export function explodes(r: BomRow, t: SpecTree): boolean {
  return t.assemblyIds.has(r.ChildID) && releaseOf(r) !== "assemblyOnly";
}

// Is this edge's child itself something the project has to procure?
// A leaf always is. An assembly only is when its release status says the
// assembly itself is bought ("Assembly Only" or "Both Assembly and Contents").
export function isRequirement(r: BomRow, t: SpecTree): boolean {
  if (!t.assemblyIds.has(r.ChildID)) return true;
  const rel = releaseOf(r);
  return rel === "assemblyOnly" || rel === "bothAssemblyAndContents";
}

// Every procurement requirement under `nodeId`, release status applied. Replaces
// the old `getLeafParts`: it stops at Assembly Only parents (taking the parent
// instead of its contents) and counts Both-Assembly-and-Contents parents in
// addition to descending through them. `visited` is shared across a whole roots
// pass, as in the reference report, so a structural cycle can't loop forever.
export function getRequirementRows(nodeId: number, t: SpecTree, visited: Set<number>): BomRow[] {
  if (visited.has(nodeId)) return [];
  visited.add(nodeId);
  const out: BomRow[] = [];
  for (const child of t.childrenMap.get(nodeId) ?? []) {
    if (isRequirement(child, t)) out.push(child);
    if (explodes(child, t)) out.push(...getRequirementRows(child.ChildID, t, visited));
  }
  return out;
}

// ── Coverage + costing ───────────────────────────────────────────────────────

const qtyOf = (r: BomRow) => Number(r.ItemQty) || 0;

// Total in hand = PO receipts + inventory actually issued to the job. A stock
// part is physically present exactly as much as a received PO part is.
export function receivedQtyFor(r: BomRow, ctx: BomContext): number {
  const pull = ctx.pulls.get(r.ChildID);
  return (Number(r.ReceivedQty) || 0) + (pull?.fulfilledQty ?? 0);
}

export function sourceFor(r: BomRow, ctx: BomContext): PartSource {
  if ((Number(r.POQty) || 0) > 0) return "po";
  const pull = ctx.pulls.get(r.ChildID);
  if (pull && pull.pullQty > 0) return "stock";
  if (ctx.processItems.has(r.ChildID)) return "process";
  return "none";
}

// Three-state readiness over one requirement. `noPO` now means *uncovered* —
// no PO, no stock pull, no process schedule — rather than merely un-purchased.
export function statusFor(r: BomRow, ctx: BomContext): "received" | "ordered" | "noPO" {
  const qty = qtyOf(r);
  if (receivedQtyFor(r, ctx) >= qty) return "received";
  return sourceFor(r, ctx) === "none" ? "noPO" : "ordered";
}

// The one true "needs a PO" eligibility rule. Genuinely uncovered — per
// statusFor, so BOM release status, inventory pulls and process schedules are
// already applied — AND not paused on hold (a held part gets its own bucket
// in the UI; chasing a PO for something paused isn't useful).
//
// Every view that counts or lists "No PO" parts — the risk card, the Parts
// List "Uncovered (no PO)" filter, the readiness summary, "See all" — must
// call this rather than re-deriving coverage from a raw field like an empty
// PO number, which misses stock/process coverage and BOM release status
// entirely (see this file's header) and is exactly the bug this fixes.
export function isUncoveredPart(p: Pick<BomPart, "status" | "hold">): boolean {
  return p.status === "noPO" && !p.hold;
}

// Unit price, most-committed source first: what this job actually agreed to pay,
// then what it actually paid to pull from stock, then the BOM line's own figure,
// then the item master's last purchased price (LPP), then list.
export function unitPriceFor(r: BomRow, ctx: BomContext): { price: number; basis: CostBasis } {
  const po = Number(r.UnitPrice) || 0;
  if (po > 0) return { price: po, basis: "po" };
  const pull = ctx.pulls.get(r.ChildID)?.pullPrice ?? 0;
  if (pull > 0) return { price: pull, basis: "pull" };
  const bom = Number(r.ItemCost) || 0;
  if (bom > 0) return { price: bom, basis: "bom" };
  const last = Number(r.ItemLastCost) || 0;
  if (last > 0) return { price: last, basis: "lastCost" };
  const list = Number(r.ItemListCost) || 0;
  if (list > 0) return { price: list, basis: "listCost" };
  return { price: 0, basis: "none" };
}

// Readiness over UNIQUE requirements (deduped by ChildID), matching the
// reference report's unique-part counting.
export function statsForRoots(rootIds: number[], t: SpecTree, ctx: BomContext): BomStats {
  const visited = new Set<number>();
  const rows: BomRow[] = [];
  for (const id of rootIds) rows.push(...getRequirementRows(id, t, visited));
  const byChild = new Map<number, BomRow>();
  for (const r of rows) if (!byChild.has(r.ChildID)) byChild.set(r.ChildID, r);
  const unique = [...byChild.values()];

  let received = 0;
  let ordered = 0;
  let noPO = 0;
  let stock = 0;
  for (const r of unique) {
    const st = statusFor(r, ctx);
    if (st === "received") received++;
    else if (st === "ordered") ordered++;
    else noPO++;
    const src = sourceFor(r, ctx);
    if (src === "stock" || src === "process") stock++;
  }
  const total = unique.length;
  return { total, received, noPO, ordered, stock, pct: total ? Math.round((received / total) * 100) : 0 };
}

export function makePart(r: BomRow, t: SpecTree, ctx: BomContext): BomPart {
  const qty = qtyOf(r);
  const line = (ctx.poIndex.get(r.ChildID) ?? [])[0];
  const pull = ctx.pulls.get(r.ChildID);
  const { price, basis } = unitPriceFor(r, ctx);
  const release = releaseOf(r);
  return {
    id: r.ChildID,
    pn: clean(r.ChildPN) || "—",
    desc: clean(r.ChildDesc),
    manufacturer: clean(r.Manufacturer),
    qty,
    poQty: Number(r.POQty) || 0,
    receivedQty: receivedQtyFor(r, ctx),
    unitPrice: price,
    costBasis: basis,
    source: sourceFor(r, ctx),
    release,
    isAssembly: t.assemblyIds.has(r.ChildID),
    pullQty: pull?.pullQty ?? 0,
    requiredDate: iso(r.RequiredDate),
    expectedDate: line?.dueDate ?? null,
    originalDate: line?.originalDate ?? null,
    revisedDate: line?.revisedDate ?? null,
    poDate: line?.orderedDate ?? null,
    receivedDate: iso(r.LastReceivedDate) ?? iso(pull?.fulfilledDate ?? null),
    status: statusFor(r, ctx),
    hold: !!r.ItemHold,
    supplier: line?.supplier ?? null,
    poId: line?.poId ?? null,
  };
}

// ── Node building ────────────────────────────────────────────────────────────

// Roll cost/qty/nesting from a node's own line, its direct parts and its
// children. One place, so a node's totals can never disagree with its parts.
export function rollUp(node: BomNode): void {
  let cost = node.self ? node.self.unitPrice * node.self.qty : 0;
  let pq = node.self ? node.self.qty : 0;
  let nested = 0;
  for (const p of node.parts) {
    cost += p.unitPrice * p.qty;
    pq += p.qty;
  }
  for (const c of node.children) {
    cost += c.totalCost;
    pq += c.totalPartQty;
    nested += c.nestedAssemblies + 1;
  }
  node.totalCost = cost;
  node.totalPartQty = pq;
  node.nestedAssemblies = nested;
}

// Build a nested assembly node. `keyPath` keeps each instance unique; the
// ancestor set guards against structural cycles without collapsing legitimately
// shared sub-assemblies (they render fully under each parent, as in the ref).
//
// `selfRow` is the edge that reached this node; it is what carries the release
// status, so it also decides whether the node has its own procurement line.
export function buildAssembly(
  nodeId: number,
  pn: string,
  desc: string,
  keyPath: string,
  t: SpecTree,
  ctx: BomContext,
  ancestors: Set<number>,
  selfRow: BomRow | null,
): BomNode {
  const release = selfRow ? releaseOf(selfRow) : "contentsOnly";
  const node: BomNode = {
    key: keyPath,
    id: nodeId,
    depth: 0,
    label: desc ? (pn ? `${pn} — ${desc}` : desc) : pn,
    pn: pn || "—",
    desc,
    isAssembly: true,
    release,
    self: selfRow && release === "bothAssemblyAndContents" ? makePart(selfRow, t, ctx) : null,
    children: [],
    parts: [],
    stats: statsForRoots([nodeId], t, ctx),
    totalCost: 0,
    totalPartQty: 0,
    nestedAssemblies: 0,
  };

  if (!ancestors.has(nodeId)) {
    const nextAncestors = new Set(ancestors).add(nodeId);
    for (const child of t.childrenMap.get(nodeId) ?? []) {
      if (explodes(child, t)) {
        node.children.push(
          buildAssembly(
            child.ChildID,
            clean(child.ChildPN),
            clean(child.ChildDesc),
            `${keyPath}/${child.ChildID}`,
            t,
            ctx,
            nextAncestors,
            child,
          ),
        );
      } else if (isRequirement(child, t)) {
        // A leaf part, or an Assembly-Only sub-assembly bought whole. Either way
        // it is one line to buy and nothing beneath it is a requirement.
        node.parts.push(makePart(child, t, ctx));
      }
    }
  }

  rollUp(node);
  return withSelfInStats(node);
}

// `statsForRoots` counts an assembly's OWN requirement line (release 2/3) as
// part of its parent's rollup, but a node's own `stats` are computed from
// [nodeId] — which walks its contents only. For "Both Assembly and Contents"
// that would drop the assembly itself out of its own readiness figure, so fold
// it back in.
// ── Buildable quantity by limiting component (Build Readiness dashboard) ────
//
// "Given the quantities currently AVAILABLE (in-hand: PO receipts + fulfilled
// inventory pulls — the same `receivedQty` used everywhere else in this file,
// never on-order-but-not-received), how many complete units of this assembly
// could actually be built right now?" — the limiting-component MRP calc:
// BuildableQty = MIN over every required component of floor(available / required-per-unit).
//
// Scoped to THIS node's own direct requirements only (`node.self` + `node.parts`) —
// it does not recurse into a child sub-assembly's own buildability. A nested
// sub-assembly is itself a separate buildable unit with its own number; folding
// it into the parent's limiting-component set would conflate "we can build the
// sub-assembly" with "we have the sub-assembly already built and in hand",
// which are different questions this function isn't asked to answer.
//
// `ItemQty` (BomPart.qty) is the quantity needed for THIS JOB'S entire required
// build count of the assembly (matching rollUp's own totalCost/totalPartQty,
// which add `p.qty` directly with no per-instance multiplication) — not "per one
// assembly unit". Dividing by the assembly's own required qty (`node.self.qty`)
// recovers the per-unit ratio the MIN/floor formula needs.
export type BuildableInfo = {
  buildableQty: number; // complete units buildable right now
  buildablePct: number; // buildableQty / assembly's own required qty, capped at 100
  limitingParts: { pn: string; available: number; required: number }[]; // the actual bottleneck(s) — every part tied for the minimum
};

// `null` when the node has no own buy/build line at all (a pure "Contents Only"
// container — e.g. a section, or an assembly whose contents are the requirement
// rather than the assembly itself) — there is no "how many units" question to
// answer for something that was never itself a unit to build.
export function buildableQtyFor(node: BomNode): BuildableInfo | null {
  if (!node.self) return null;
  const unitQty = node.self.qty > 0 ? node.self.qty : 1;

  if (node.parts.length === 0) {
    // No recorded components under this assembly — its own line is the only
    // requirement, so buildability is just its own coverage.
    const buildableQty = Math.min(node.self.receivedQty, unitQty);
    return {
      buildableQty,
      buildablePct: Math.min(100, Math.round((buildableQty / unitQty) * 100)),
      limitingParts: [],
    };
  }

  let buildableQty = Infinity;
  const perUnitByPart = new Map<string, number>();
  for (const p of node.parts) {
    const perUnit = p.qty / unitQty;
    if (perUnit <= 0) continue; // a zero/negative BOM qty gates nothing
    perUnitByPart.set(p.pn, perUnit);
    const possible = Math.floor(p.receivedQty / perUnit);
    if (possible < buildableQty) buildableQty = possible;
  }
  if (!Number.isFinite(buildableQty)) buildableQty = unitQty; // no part with a positive required qty — nothing to gate it
  buildableQty = Math.max(0, buildableQty);

  const limitingParts = node.parts
    .filter((p) => {
      const perUnit = perUnitByPart.get(p.pn);
      return perUnit != null && Math.floor(p.receivedQty / perUnit) === buildableQty;
    })
    .map((p) => ({ pn: p.pn, available: p.receivedQty, required: perUnitByPart.get(p.pn)! }));

  return { buildableQty, buildablePct: Math.min(100, Math.round((buildableQty / unitQty) * 100)), limitingParts };
}

export function withSelfInStats(node: BomNode): BomNode {
  if (!node.self) return node;
  const s = node.stats;
  const st = node.self.status;
  const src = node.self.source;
  node.stats = {
    total: s.total + 1,
    received: s.received + (st === "received" ? 1 : 0),
    ordered: s.ordered + (st === "ordered" ? 1 : 0),
    noPO: s.noPO + (st === "noPO" ? 1 : 0),
    stock: s.stock + (src === "stock" || src === "process" ? 1 : 0),
    pct: 0,
  };
  node.stats.pct = node.stats.total ? Math.round((node.stats.received / node.stats.total) * 100) : 0;
  return node;
}
