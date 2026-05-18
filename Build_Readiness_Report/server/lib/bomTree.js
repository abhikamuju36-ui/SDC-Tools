/**
 * BOM tree builder — takes flat rows from ETO and builds a hierarchy
 * with readiness stats for every assembly node.
 */

function buildTree(rows) {
  // 1. Deduplicate by (ChildID, ParentID)
  const seen = new Set();
  const deduped = rows.filter(r => {
    const k = `${r.ChildID}-${r.ParentID}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // 2. Determine which IDs are assemblies (appear as ParentID)
  const assemblyIds = new Set(deduped.map(r => r.ParentID));

  // 3. Build parent → children map
  const childrenMap = {};
  deduped.forEach(r => {
    if (!childrenMap[r.ParentID]) childrenMap[r.ParentID] = [];
    childrenMap[r.ParentID].push(r);
  });

  // 4. Find top-level parent IDs (parents that never appear as children in this set)
  const childIds = new Set(deduped.map(r => r.ChildID));
  const topParentIds = [...new Set(deduped.map(r => r.ParentID))]
    .filter(p => !childIds.has(p));

  return { assemblyIds, childrenMap, topParentIds, deduped };
}

/**
 * Recursively collect all leaf (non-assembly) parts under a node.
 */
function getLeafParts(nodeId, childrenMap, assemblyIds, visited = new Set()) {
  if (visited.has(nodeId)) return [];
  visited.add(nodeId);
  const parts = [];
  const children = childrenMap[nodeId] || [];
  children.forEach(child => {
    if (assemblyIds.has(child.ChildID)) {
      parts.push(...getLeafParts(child.ChildID, childrenMap, assemblyIds, visited));
    } else {
      parts.push(child);
    }
  });
  return parts;
}

/**
 * Compute readiness stats for an assembly.
 */
function getAssemblyStats(nodeId, childrenMap, assemblyIds) {
  const parts = getLeafParts(nodeId, childrenMap, assemblyIds);
  // Dedupe leaf parts by ChildID (same part used multiple places)
  const unique = Object.values(
    parts.reduce((acc, p) => {
      acc[p.ChildID] = acc[p.ChildID] || p;
      return acc;
    }, {})
  );
  const total = unique.length;
  const received = unique.filter(p => p.ReceivedQty >= p.ItemQty).length;
  const noPO = unique.filter(p => p.POQty === 0 && p.ReceivedQty < p.ItemQty).length;
  const ordered = unique.filter(p => p.POQty > 0 && p.ReceivedQty < p.ItemQty).length;
  const pct = total ? Math.round((received / total) * 100) : 0;
  return { total, received, noPO, ordered, pct };
}

/**
 * Build a full nested tree structure for the frontend.
 * Each node has: { id, pn, desc, qty, isAssembly, stats?, children[], parts[] }
 */
/**
 * @param poIndex — optional map of ItemID → [{poId, supplier, dueDate, qty, received}]
 */
function buildNestedTree(topNodeId, topPN, topDesc, childrenMap, assemblyIds, poIndex) {
  function recurse(nodeId, pn, desc, qty) {
    const isAssembly = assemblyIds.has(nodeId);
    const node = {
      id: nodeId,
      pn: pn || '???',
      desc: desc || '',
      qty: qty || 1,
      isAssembly,
      children: [],
      parts: [],
    };

    if (isAssembly) {
      node.stats = getAssemblyStats(nodeId, childrenMap, assemblyIds);
      const kids = childrenMap[nodeId] || [];
      kids.forEach(child => {
        if (assemblyIds.has(child.ChildID)) {
          node.children.push(recurse(child.ChildID, child.ChildPN, child.ChildDesc, child.ItemQty));
        } else {
          const poLines = poIndex ? (poIndex[child.ChildID] || []) : [];
          node.parts.push({
            id: child.ChildID,
            pn: child.ChildPN,
            desc: child.ChildDesc,
            manufacturer: child.Manufacturer,
            qty: child.ItemQty,
            poQty: child.POQty,
            receivedQty: child.ReceivedQty,
            requiredDate: child.RequiredDate,
            unitPrice: child.UnitPrice || 0,
            receivedDate: child.LastReceivedDate || null,
            status: child.ReceivedQty >= child.ItemQty ? 'received'
              : child.POQty > 0 ? 'ordered'
              : 'noPO',
            pos: poLines, // PO detail lines for this part
          });
        }
      });
    }
    return node;
  }

  return recurse(topNodeId, topPN, topDesc, 1);
}

/**
 * Build a PO index: ItemID → array of PO line detail objects.
 */
function buildPoIndex(poRows) {
  const idx = {};
  (poRows || []).forEach(row => {
    if (!idx[row.ItemID]) idx[row.ItemID] = [];
    idx[row.ItemID].push({
      poId: row.PurchaseOrderID,
      supplier: row.Supplier,
      supplierEmail: row.SupplierEmail,
      dueDate: row.DateRequired || row.PurchaseDateRequired,
      poDate: row.PurchaseDate,
      qty: row.PurchaseQty,
      received: row.ReceivedQty,
      price: row.PurchasePrice,
      receivedDate: row.LastReceivedDate || null,
    });
  });
  return idx;
}

/**
 * Build the readiness summary structured by machine hierarchy.
 *
 * Returns an array of "machines" — each is a top-level child of TOP.
 * Each machine has:
 *   - its own stats (overall readiness)
 *   - subAssemblies[] grouped into ready/close/blocked
 *   - looseParts[] (direct leaf children)
 *
 * For single-machine projects (1119): TOP → 1119-A-000 → sub-assemblies
 *   → returns [{machine: 1119-A-000, subAssemblies: [...]}]
 *
 * For multi-machine projects (1083): TOP → many peers
 *   → returns [{machine: 1083-B-000, ...}, {machine: 1083-D-000, ...}, ...]
 */
function buildReadinessSummary(topNodeId, topPN, topDesc, childrenMap, assemblyIds, poIndex) {
  const tree = buildNestedTree(topNodeId, topPN, topDesc, childrenMap, assemblyIds, poIndex);

  const machines = [];

  // Each top-level assembly child of TOP is a "machine"
  tree.children.forEach(machineNode => {
    const machine = {
      id: machineNode.id,
      pn: machineNode.pn,
      desc: machineNode.desc,
      qty: machineNode.qty,
      stats: machineNode.stats,
      // Sub-assemblies under this machine, grouped by readiness
      subAssemblies: { ready: [], close: [], blocked: [] },
      // Direct parts of this machine (not in a sub-assembly)
      parts: machineNode.parts || [],
      // The full nested node for tree view
      node: machineNode,
    };

    // If the machine has sub-assemblies, group them by readiness
    if (machineNode.children && machineNode.children.length > 0) {
      machineNode.children.forEach(sub => {
        if (sub.isAssembly && sub.stats) {
          if (sub.stats.pct === 100) machine.subAssemblies.ready.push(sub);
          else if (sub.stats.pct >= 60) machine.subAssemblies.close.push(sub);
          else machine.subAssemblies.blocked.push(sub);
        }
      });
      machine.subAssemblies.close.sort((a, b) => b.stats.pct - a.stats.pct);
      machine.subAssemblies.blocked.sort((a, b) => b.stats.pct - a.stats.pct);
    }

    machines.push(machine);
  });

  // Loose parts at top level (parts directly under TOP, not under any machine)
  if (tree.parts && tree.parts.length > 0) {
    const looseParts = tree.parts;
    const received = looseParts.filter(p => p.status === 'received').length;
    const stats = {
      total: looseParts.length,
      received,
      noPO: looseParts.filter(p => p.status === 'noPO').length,
      ordered: looseParts.filter(p => p.status === 'ordered').length,
      pct: looseParts.length ? Math.round((received / looseParts.length) * 100) : 0,
    };
    machines.push({
      id: 'loose-parts',
      pn: 'Loose Parts',
      desc: 'Individual parts not assigned to an assembly',
      qty: 1,
      stats,
      subAssemblies: { ready: [], close: [], blocked: [] },
      parts: looseParts,
      // Provide a proper node so AssemblyRow can render node.parts
      node: {
        id: 'loose-parts',
        pn: 'Loose Parts',
        desc: 'Individual parts not assigned to an assembly',
        isAssembly: true,
        children: [],
        parts: looseParts,
        stats,
      },
    });
  }

  return { machines, tree };
}

/**
 * Process PO data into action list grouped by urgency.
 */
function buildPoActionList(poRows) {
  const now = new Date();

  // Group by supplier
  const bySupplier = {};
  poRows.forEach(row => {
    const key = row.Supplier || 'Unknown';
    if (!bySupplier[key]) {
      bySupplier[key] = {
        supplier: row.Supplier,
        email: row.SupplierEmail,
        phone: row.SupplierPhone,
        pos: {},
      };
    }
    const poKey = row.PurchaseOrderID;
    if (!bySupplier[key].pos[poKey]) {
      bySupplier[key].pos[poKey] = {
        poId: row.PurchaseOrderID,
        poDate: row.PurchaseDate,
        dueDate: row.PurchaseDateRequired,
        parts: [],
      };
    }
    const dueDate = row.DateRequired || row.PurchaseDateRequired;
    const daysUntilDue = dueDate ? Math.ceil((new Date(dueDate) - now) / 86400000) : null;

    bySupplier[key].pos[poKey].parts.push({
      partNumber: row.PartNumber,
      partDesc: row.PartDesc,
      qty: row.PurchaseQty,
      received: row.ReceivedQty,
      remaining: row.PurchaseQty - row.ReceivedQty,
      requiredDate: row.DateRequired,
      expectedDate: row.PurchaseDateRequired,
      dueDate,
      daysUntilDue,
      price: row.PurchasePrice,
      receivedDate: row.LastReceivedDate || null,
    });
  });

  // Flatten and categorize
  const critical = [];  // overdue
  const warning = [];   // due within 14 days
  const onTrack = [];   // due later
  const delivered = []; // fully received

  Object.values(bySupplier).forEach(supplier => {
    Object.values(supplier.pos).forEach(po => {
      const allRcvd = po.parts.every(p => p.received >= p.qty);
      const activeParts = po.parts.filter(p => p.received < p.qty);
      
      const worstDays = activeParts.length > 0 
        ? Math.min(...activeParts.map(p => p.daysUntilDue ?? Infinity))
        : Infinity;

      const entry = {
        ...supplier,
        po,
        worstDays,
      };
      delete entry.pos;

      if (allRcvd) {
        delivered.push(entry);
      } else if (worstDays < 0) {
        critical.push(entry);
      } else if (worstDays <= 14) {
        warning.push(entry);
      } else {
        onTrack.push(entry);
      }
    });
  });

  critical.sort((a, b) => a.worstDays - b.worstDays);
  warning.sort((a, b) => a.worstDays - b.worstDays);
  onTrack.sort((a, b) => a.worstDays - b.worstDays);

  // Also collect parts with NO PO at all (from BOM data, handled separately)

  return { critical, warning, onTrack, delivered };
}

/**
 * Find parts with no PO from BOM rows.
 */
function findNoPoParts(bomRows, assemblyIds) {
  const seen = new Set();
  return bomRows
    .filter(r => !assemblyIds.has(r.ChildID)) // leaf parts only
    .filter(r => r.POQty === 0 && r.ReceivedQty < r.ItemQty)
    .filter(r => {
      if (seen.has(r.ChildID)) return false;
      seen.add(r.ChildID);
      return true;
    })
    .map(r => ({
      id: r.ChildID,
      pn: r.ChildPN,
      desc: r.ChildDesc,
      qty: r.ItemQty,
      parentPN: r.ParentPN,
      parentDesc: r.ParentDesc,
      manufacturer: r.Manufacturer,
      requiredDate: r.RequiredDate,
      unitPrice: r.UnitPrice || 0,
    }));
}

module.exports = {
  buildTree,
  getLeafParts,
  getAssemblyStats,
  buildNestedTree,
  buildReadinessSummary,
  buildPoActionList,
  buildPoIndex,
  findNoPoParts,
};
