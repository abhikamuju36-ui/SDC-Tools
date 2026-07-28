import "server-only";
import sql from "mssql";

// Native procurement BOM — ported from the Build Readiness report
// (Centrailized library/Build_Readiness_Report). Instead of the cost-only
// `vwEngBOM` explosion this used to run, it now pulls the same engineering
// product structure the Build Readiness page uses (tblEngProductStructure +
// tblEngItemMaster) plus purchase-order / receiver data, so every leaf part
// carries its PO status, supplier, and dates and every assembly carries a
// readiness rollup — exactly matching the reference app's data + status logic.
//
// Hierarchy: one synthetic section node per SpecID (the report's
// "sections" 10/30/40/90) → the spec's top node(s) from tblEngTop are exploded
// into nested assemblies → leaf parts. Status/stats logic mirrors
// server/lib/bomTree.js verbatim (assemblyIds = every ParentID; a part is
// `received` when ReceivedQty >= ItemQty, else `ordered` when POQty > 0, else
// `noPO`; assembly readiness is computed over UNIQUE leaf parts deduped by
// ChildID). Kept defensive/fail-soft: an unknown job or a query error yields an
// empty JobBom.

export type BomStats = {
  total: number;
  received: number;
  noPO: number;
  ordered: number;
  pct: number;
};

export type BomPart = {
  id: number;
  pn: string;
  desc: string;
  manufacturer: string;
  qty: number;
  poQty: number;
  receivedQty: number;
  unitPrice: number;
  requiredDate: string | null; // eps.RequiredDate — when the part is needed
  expectedDate: string | null; // PO dueDate (DateRequired || PurchaseDateRequired)
  receivedDate: string | null; // LastReceivedDate
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
  stats: BomStats;
  children: BomNode[]; // nested sub-assemblies
  parts: BomPart[]; // direct leaf parts
  totalCost: number; // Σ unitPrice × qty over descendant leaf parts
  totalPartQty: number; // Σ qty over descendant leaf parts
  nestedAssemblies: number; // count of descendant assemblies
};

// Authoritative per-line PO data (from tblPurchaseOrderDetails + tblReceiverLog)
// — the supplier's own line counts, independent of the BOM explosion. Used to
// override the BOM-derived received/total in the Card view + PO panel.
export type PoLineDetail = {
  partNumber: string;
  desc: string;
  qty: number;
  price: number;
  orderedDate: string | null; // poh.PurchaseDate
  expectedDate: string | null; // DateRequired || PurchaseDateRequired
  receivedQty: number;
  receivedDate: string | null;
  status: "received" | "ordered"; // received when receivedQty >= qty
};

export type PoLineGroup = {
  poId: string;
  itemCount: number; // # lines on this PO
  received: number; // # lines fully received
  pct: number;
  lines: PoLineDetail[];
};

export type Vendor = {
  name: string;
  pos: PoLineGroup[];
};

export type JobBom = {
  jobId: string;
  roots: BomNode[]; // one section node per SpecID
  grandTotalCost: number;
  grandTotalPartQty: number;
  rowCount: number;
  vendors: Vendor[]; // authoritative supplier → PO line rollups (fail-soft: [])
};

// Total ETO connection — same server/db/creds as sync-totaleto.ts. DO NOT CHANGE.
const config: sql.config = {
  server: "SERVER-APP1.stevendouglas.local",
  database: "SDC",
  user: process.env.TOTALETO_DB_USER,
  password: process.env.TOTALETO_DB_PASSWORD,
  domain: "stevendouglas",
  port: 1433,
  options: { trustServerCertificate: true, encrypt: false },
  connectionTimeout: 15000,
  requestTimeout: 120000,
};

// ---------- SQL (ported from server/services/eto.js) ----------

const SPECS_SQL = `
  SELECT SpecID, SDescription
  FROM tblSpec
  WHERE ProjectID = @job
  ORDER BY SpecID`;

const TOP_SQL = `
  SELECT et.SpecID, et.ItemID AS TopItemID,
         eim.ItemCompanyID AS TopPN, eim.ItemDescription AS TopDesc
  FROM tblEngTop et
  JOIN tblEngItemMaster eim ON et.ItemID = eim.ItemID
  WHERE et.ProjectID = @job`;

// One project-wide pull (SpecID carried per row) instead of the reference's
// per-spec round-trip — the PO/received subqueries are keyed by ItemID +
// ProjectID (not SpecID), so the per-row values are byte-identical.
const BOM_SQL = `
  SELECT
    eps.ChildID,
    child.ItemCompanyID   AS ChildPN,
    child.ItemDescription AS ChildDesc,
    child.Manufacturer    AS Manufacturer,
    eps.ParentID,
    parent.ItemCompanyID   AS ParentPN,
    parent.ItemDescription AS ParentDesc,
    eps.ItemQty,
    eps.SpecID,
    eps.RequiredDate,
    eps.ItemHold,
    ISNULL((
      SELECT SUM(pod.PurchaseQty)
      FROM tblPurchaseOrderDetails pod
      WHERE pod.ProjectID = @job AND pod.ItemID = eps.ChildID
    ), 0) AS POQty,
    ISNULL((
      SELECT SUM(rl.QtyReceived)
      FROM tblReceiverLog rl
      JOIN tblPurchaseOrderDetails pod2 ON rl.PurchaseDetailID = pod2.PurchaseDetailID
      WHERE pod2.ProjectID = @job AND pod2.ItemID = eps.ChildID
    ), 0) AS ReceivedQty,
    ISNULL((
      SELECT TOP 1 pod3.PurchasePrice
      FROM tblPurchaseOrderDetails pod3
      WHERE pod3.ProjectID = @job AND pod3.ItemID = eps.ChildID AND pod3.PurchasePrice > 0
      ORDER BY pod3.PurchaseDetailID DESC
    ), 0) AS UnitPrice,
    (
      SELECT TOP 1 rl3.[Date]
      FROM tblReceiverLog rl3
      JOIN tblPurchaseOrderDetails pod5 ON rl3.PurchaseDetailID = pod5.PurchaseDetailID
      WHERE pod5.ProjectID = @job AND pod5.ItemID = eps.ChildID
      ORDER BY rl3.[Date] DESC
    ) AS LastReceivedDate
  FROM tblEngProductStructure eps
  JOIN tblEngItemMaster child  ON eps.ChildID  = child.ItemID
  JOIN tblEngItemMaster parent ON eps.ParentID = parent.ItemID
  WHERE eps.ProjectID = @job
  ORDER BY eps.SpecID, parent.ItemCompanyID, child.ItemCompanyID`;

// Full per-line PO query (mirrors Build Readiness getPoDetails) — every real PO
// line with its own received qty/date, so vendor cards can show authoritative
// line counts and the PO panel can list lines that aren't in the BOM. The
// per-part supplier/expected join (buildPoIndex) still reads from these rows.
const PO_SQL = `
  SELECT
    poh.PurchaseOrderID,
    poh.PurchaseDate,
    poh.PurchaseDateRequired,
    c.CName AS Supplier,
    pod.PurchaseDetailID,
    pod.ItemID,
    eim.ItemCompanyID AS PartNumber,
    eim.ItemDescription AS PartDesc,
    pod.PurchaseQty,
    pod.PurchasePrice,
    pod.DateRequired,
    ISNULL((
      SELECT SUM(rl.QtyReceived)
      FROM tblReceiverLog rl
      WHERE rl.PurchaseDetailID = pod.PurchaseDetailID
    ), 0) AS ReceivedQty,
    (
      SELECT TOP 1 rl2.[Date]
      FROM tblReceiverLog rl2
      WHERE rl2.PurchaseDetailID = pod.PurchaseDetailID
      ORDER BY rl2.[Date] DESC
    ) AS LastReceivedDate
  FROM tblPurchaseOrderDetails pod
  JOIN tblPurchaseOrderHeader poh ON pod.PurchaseOrderID = poh.PurchaseOrderID
  JOIN tblCompany c               ON poh.PurchaseSupplierID = c.CompanyID
  JOIN tblEngItemMaster eim       ON pod.ItemID = eim.ItemID
  WHERE pod.ProjectID = @job
    AND eim.ItemCompanyID NOT IN ('Shipping', 'FEE', 'TARIFF')
  ORDER BY c.CName, pod.DateRequired`;

// ---------- Row shapes ----------

type BomRow = {
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
  ItemHold: boolean | null;
  POQty: number | null;
  ReceivedQty: number | null;
  UnitPrice: number | null;
  LastReceivedDate: Date | null;
};

type TopRow = { SpecID: number; TopItemID: number; TopPN: string | null; TopDesc: string | null };
type SpecRow = { SpecID: number; SDescription: string | null };
type PoRow = {
  PurchaseOrderID: string | number | null;
  PurchaseDate: Date | null;
  PurchaseDateRequired: Date | null;
  Supplier: string | null;
  PurchaseDetailID: number | null;
  ItemID: number;
  PartNumber: string | null;
  PartDesc: string | null;
  PurchaseQty: number | null;
  PurchasePrice: number | null;
  DateRequired: Date | null;
  ReceivedQty: number | null;
  LastReceivedDate: Date | null;
};

type PoLine = { poId: string | null; supplier: string | null; dueDate: string | null };

// ---------- Helpers ----------

const iso = (d: Date | null | undefined): string | null => {
  if (!d) return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
};
const clean = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

// PO index: ItemID → PO lines. Supplier/expected-date for a part come from its
// first PO line (dueDate = DateRequired || PurchaseDateRequired), matching
// buildPoIndex in the reference.
function buildPoIndex(rows: PoRow[]): Map<number, PoLine[]> {
  const idx = new Map<number, PoLine[]>();
  for (const r of rows) {
    const line: PoLine = {
      poId: r.PurchaseOrderID != null ? String(r.PurchaseOrderID) : null,
      supplier: r.Supplier ?? null,
      dueDate: iso(r.DateRequired ?? r.PurchaseDateRequired),
    };
    const arr = idx.get(r.ItemID);
    if (arr) arr.push(line);
    else idx.set(r.ItemID, [line]);
  }
  return idx;
}

// Authoritative vendor → PO line rollups from the raw PO rows (mirrors the
// reference buildPoIndex/getPoDetails shape used by the Scheduler's card merge).
// Fully fail-soft: any error yields [] so the BOM-derived counts stay in charge.
function buildVendors(rows: PoRow[]): Vendor[] {
  try {
    const byVendor = new Map<string, Map<string, PoLineDetail[]>>();
    for (const r of rows) {
      const poId = r.PurchaseOrderID != null ? String(r.PurchaseOrderID) : "";
      if (!poId) continue;
      const name = clean(r.Supplier) || "No Supplier";
      const qty = Number(r.PurchaseQty) || 0;
      const receivedQty = Number(r.ReceivedQty) || 0;
      const line: PoLineDetail = {
        partNumber: clean(r.PartNumber) || "—",
        desc: clean(r.PartDesc),
        qty,
        price: Number(r.PurchasePrice) || 0,
        orderedDate: iso(r.PurchaseDate),
        expectedDate: iso(r.DateRequired ?? r.PurchaseDateRequired),
        receivedQty,
        receivedDate: iso(r.LastReceivedDate),
        status: receivedQty >= qty ? "received" : "ordered",
      };
      let pos = byVendor.get(name);
      if (!pos) byVendor.set(name, (pos = new Map()));
      const arr = pos.get(poId);
      if (arr) arr.push(line);
      else pos.set(poId, [line]);
    }
    const vendors: Vendor[] = [];
    for (const [name, poMap] of byVendor) {
      const pos: PoLineGroup[] = [];
      for (const [poId, lines] of poMap) {
        const itemCount = lines.length;
        const received = lines.filter((l) => l.receivedQty >= l.qty).length;
        const pct = itemCount ? Math.round((received / itemCount) * 100) : 0;
        pos.push({ poId, itemCount, received, pct, lines });
      }
      vendors.push({ name, pos });
    }
    return vendors;
  } catch {
    return [];
  }
}

// Everything for one spec's tree: dedupe edges, find assemblies + roots.
type SpecTree = {
  assemblyIds: Set<number>;
  childrenMap: Map<number, BomRow[]>;
  deduped: BomRow[];
};

function buildSpecTree(rows: BomRow[]): SpecTree {
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

// Recursively collect all leaf (non-assembly) rows under a node — reference
// getLeafParts, including the shared-visited behaviour that prevents cycles.
function getLeafRows(nodeId: number, t: SpecTree, visited: Set<number>): BomRow[] {
  if (visited.has(nodeId)) return [];
  visited.add(nodeId);
  const out: BomRow[] = [];
  for (const child of t.childrenMap.get(nodeId) ?? []) {
    if (t.assemblyIds.has(child.ChildID)) {
      out.push(...getLeafRows(child.ChildID, t, visited));
    } else {
      out.push(child);
    }
  }
  return out;
}

// Readiness stats over UNIQUE leaf parts (deduped by ChildID) — reference
// getAssemblyStats verbatim.
function statsForRoots(rootIds: number[], t: SpecTree): BomStats {
  const visited = new Set<number>();
  const leaves: BomRow[] = [];
  for (const id of rootIds) leaves.push(...getLeafRows(id, t, visited));
  const byChild = new Map<number, BomRow>();
  for (const p of leaves) if (!byChild.has(p.ChildID)) byChild.set(p.ChildID, p);
  const unique = [...byChild.values()];
  const total = unique.length;
  const qty = (r: BomRow) => Number(r.ItemQty) || 0;
  const rec = (r: BomRow) => Number(r.ReceivedQty) || 0;
  const po = (r: BomRow) => Number(r.POQty) || 0;
  const received = unique.filter((r) => rec(r) >= qty(r)).length;
  const noPO = unique.filter((r) => po(r) === 0 && rec(r) < qty(r)).length;
  const ordered = unique.filter((r) => po(r) > 0 && rec(r) < qty(r)).length;
  const pct = total ? Math.round((received / total) * 100) : 0;
  return { total, received, noPO, ordered, pct };
}

function makePart(r: BomRow, poIndex: Map<number, PoLine[]>): BomPart {
  const qty = Number(r.ItemQty) || 0;
  const receivedQty = Number(r.ReceivedQty) || 0;
  const poQty = Number(r.POQty) || 0;
  const line = (poIndex.get(r.ChildID) ?? [])[0];
  return {
    id: r.ChildID,
    pn: clean(r.ChildPN) || "—",
    desc: clean(r.ChildDesc),
    manufacturer: clean(r.Manufacturer),
    qty,
    poQty,
    receivedQty,
    unitPrice: Number(r.UnitPrice) || 0,
    requiredDate: iso(r.RequiredDate),
    expectedDate: line?.dueDate ?? null,
    receivedDate: iso(r.LastReceivedDate),
    status: receivedQty >= qty ? "received" : poQty > 0 ? "ordered" : "noPO",
    hold: !!r.ItemHold,
    supplier: line?.supplier ?? null,
    poId: line?.poId ?? null,
  };
}

// Build a nested assembly node. `keyPath` keeps each instance unique; the
// ancestor set guards against structural cycles without collapsing legitimately
// shared sub-assemblies (they render fully under each parent, as in the ref).
function buildAssembly(
  nodeId: number,
  pn: string,
  desc: string,
  keyPath: string,
  t: SpecTree,
  poIndex: Map<number, PoLine[]>,
  ancestors: Set<number>,
): BomNode {
  const node: BomNode = {
    key: keyPath,
    id: nodeId,
    depth: 0,
    label: desc ? (pn ? `${pn} — ${desc}` : desc) : pn,
    pn: pn || "—",
    desc,
    isAssembly: true,
    stats: statsForRoots([nodeId], t),
    children: [],
    parts: [],
    totalCost: 0,
    totalPartQty: 0,
    nestedAssemblies: 0,
  };

  if (!ancestors.has(nodeId)) {
    const nextAncestors = new Set(ancestors).add(nodeId);
    for (const child of t.childrenMap.get(nodeId) ?? []) {
      if (t.assemblyIds.has(child.ChildID)) {
        node.children.push(
          buildAssembly(
            child.ChildID,
            clean(child.ChildPN),
            clean(child.ChildDesc),
            `${keyPath}/${child.ChildID}`,
            t,
            poIndex,
            nextAncestors,
          ),
        );
      } else {
        node.parts.push(makePart(child, poIndex));
      }
    }
  }

  let cost = 0;
  let pq = 0;
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
  return node;
}

// ---------- Entry point ----------

export async function getJobBom(jobId: string): Promise<JobBom> {
  const empty: JobBom = {
    jobId: String(jobId),
    roots: [],
    grandTotalCost: 0,
    grandTotalPartQty: 0,
    rowCount: 0,
    vendors: [],
  };

  const numericJob = Number(String(jobId).replace(/[^0-9]/g, ""));
  if (!Number.isFinite(numericJob) || numericJob === 0) return empty;
  if (!config.user || !config.password) return empty;

  let pool: sql.ConnectionPool | undefined;
  let specs: SpecRow[] = [];
  let tops: TopRow[] = [];
  let bomRows: BomRow[] = [];
  let poRows: PoRow[] = [];
  try {
    pool = await sql.connect(config);
    const [specR, topR, bomR, poR] = await Promise.all([
      pool.request().input("job", sql.Int, numericJob).query(SPECS_SQL),
      pool.request().input("job", sql.Int, numericJob).query(TOP_SQL),
      pool.request().input("job", sql.Int, numericJob).query(BOM_SQL),
      pool.request().input("job", sql.Int, numericJob).query(PO_SQL),
    ]);
    specs = specR.recordset as SpecRow[];
    tops = topR.recordset as TopRow[];
    bomRows = bomR.recordset as BomRow[];
    poRows = poR.recordset as PoRow[];
  } catch {
    return empty;
  } finally {
    if (pool) await pool.close();
  }

  if (bomRows.length === 0) return empty;

  const poIndex = buildPoIndex(poRows);
  const vendors = buildVendors(poRows); // fail-soft: [] on any error

  // Group rows + top nodes by SpecID.
  const rowsBySpec = new Map<number, BomRow[]>();
  for (const r of bomRows) {
    const arr = rowsBySpec.get(r.SpecID);
    if (arr) arr.push(r);
    else rowsBySpec.set(r.SpecID, [r]);
  }
  const topsBySpec = new Map<number, TopRow[]>();
  for (const tp of tops) {
    const arr = topsBySpec.get(tp.SpecID);
    if (arr) arr.push(tp);
    else topsBySpec.set(tp.SpecID, [tp]);
  }
  const specTitle = new Map<number, string>();
  for (const s of specs) specTitle.set(s.SpecID, clean(s.SDescription));

  // Order specs: known list first, then any leftover spec IDs that have rows.
  const specIds = [...new Set([...specs.map((s) => s.SpecID), ...rowsBySpec.keys()])].sort(
    (a, b) => a - b,
  );

  const roots: BomNode[] = [];
  let rowCount = 0;

  for (const specId of specIds) {
    const rows = rowsBySpec.get(specId);
    if (!rows || rows.length === 0) continue;
    const tree = buildSpecTree(rows);
    rowCount += tree.deduped.length;

    // Roots of this spec = the top node(s) from tblEngTop. Fall back to
    // parents that never appear as a child (reference buildTree.topParentIds).
    let topNodeIds = (topsBySpec.get(specId) ?? []).map((tp) => tp.TopItemID);
    topNodeIds = topNodeIds.filter((id) => tree.assemblyIds.has(id));
    if (topNodeIds.length === 0) {
      const childIds = new Set(tree.deduped.map((r) => r.ChildID));
      topNodeIds = [...tree.assemblyIds].filter((p) => !childIds.has(p));
    }

    // Flatten each top node's tree into the synthetic section node: the
    // section directly carries the top node(s)' assemblies + loose parts.
    const section: BomNode = {
      key: `S${specId}`,
      id: `S${specId}`,
      depth: 0,
      label: `Spec ${specId}`,
      pn: "",
      desc: specTitle.get(specId) ?? "",
      isAssembly: true,
      stats: statsForRoots(topNodeIds, tree),
      children: [],
      parts: [],
      totalCost: 0,
      totalPartQty: 0,
      nestedAssemblies: 0,
    };

    for (const topId of topNodeIds) {
      const top = buildAssembly(
        topId,
        "",
        "",
        `S${specId}/${topId}`,
        tree,
        poIndex,
        new Set<number>(),
      );
      section.children.push(...top.children);
      section.parts.push(...top.parts);
    }

    // Roll the section total from its children + loose parts.
    let cost = 0;
    let pq = 0;
    let nested = 0;
    for (const p of section.parts) {
      cost += p.unitPrice * p.qty;
      pq += p.qty;
    }
    for (const c of section.children) {
      cost += c.totalCost;
      pq += c.totalPartQty;
      nested += c.nestedAssemblies + 1;
    }
    section.totalCost = cost;
    section.totalPartQty = pq;
    section.nestedAssemblies = nested;

    if (section.children.length || section.parts.length) roots.push(section);
  }

  // Assign depth (section = 0).
  const setDepth = (n: BomNode, depth: number) => {
    n.depth = depth;
    for (const c of n.children) setDepth(c, depth + 1);
  };
  roots.forEach((r) => setDepth(r, 0));

  const grandTotalCost = roots.reduce((s, n) => s + n.totalCost, 0);
  const grandTotalPartQty = roots.reduce((s, n) => s + n.totalPartQty, 0);

  return { jobId: String(jobId), roots, grandTotalCost, grandTotalPartQty, rowCount, vendors };
}
