const express = require('express');
const router = express.Router();
const eto = require('../services/eto');
const demo = require('../services/demoData');
const { getBuildDates } = require('../services/smartsheet');
const { buildTree, buildReadinessSummary, buildPoActionList, buildPoIndex, findNoPoParts } = require('../lib/bomTree');

function db() { return demo.isDemoMode() ? demo : eto; }

// GET /api/readiness/:projectId — full readiness report
router.get('/:projectId', async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId);
    const src = db();

    const [project, specs, poRows, buildDates, projectCosting, specCosting] = await Promise.all([
      src.getProjectInfo(projectId),
      src.getSpecs(projectId),
      src.getPoDetails(projectId),
      getBuildDates(projectId).catch(() => ({ buildStart: null, buildComplete: null })),
      src.getProjectCosting(projectId).catch(() => null),
      src.getSpecCosting(projectId).catch(() => []),
    ]);

    if (!specs || specs.length === 0) {
      return res.status(404).json({ error: demo.isDemoMode()
        ? `Demo mode — no cached data for project ${projectId}. Available: ${demo.getCachedProjects().join(', ')}`
        : `No specs found for project ${projectId}` });
    }

    // Build PO index (ItemID → PO detail lines)
    const poIndex = buildPoIndex(poRows);

    // Build readiness per spec concurrently
    const specReportsRaw = await Promise.all(specs.map(async (spec) => {
      const [topNode, bomRows] = await Promise.all([
        src.getTopNode(projectId, spec.SpecID),
        src.getBomRows(projectId, spec.SpecID),
      ]);

      if (!topNode || bomRows.length === 0) return null;

      const { assemblyIds, childrenMap } = buildTree(bomRows);
      const summary = buildReadinessSummary(
        topNode.TopItemID, topNode.TopPN, topNode.TopDesc,
        childrenMap, assemblyIds, poIndex
      );
      const noPoParts = findNoPoParts(bomRows, assemblyIds);

      return {
        specId: spec.SpecID,
        specName: spec.SDescription,
        specQty: spec.SQuantity,
        topPN: topNode.TopPN,
        topDesc: topNode.TopDesc,
        machines: summary.machines,
        tree: summary.tree,
        noPoParts,
        totalParts: bomRows.filter(r => !assemblyIds.has(r.ChildID)).length,
      };
    }));

    const specReports = specReportsRaw.filter(Boolean);

    // Global dedup of noPoParts across specs — a part appearing in both spec 10 and spec 30
    // should only be reported once (first occurrence wins).
    const seenNoPo = new Set();
    specReports.forEach(s => {
      s.noPoParts = s.noPoParts.filter(p => {
        if (seenNoPo.has(p.id)) return false;
        seenNoPo.add(p.id);
        return true;
      });
    });

    // PO action list
    const poActions = buildPoActionList(poRows);

    res.json({
      project,
      specs: specReports,
      poActions,
      buildDates,
      projectCosting,
      specCosting,
      demoMode: demo.isDemoMode(),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Error building readiness report:', err);
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
